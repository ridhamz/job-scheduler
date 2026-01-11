const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutRuleCommand, PutTargetsCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, InvokeCommand, AddPermissionCommand } = require('@aws-sdk/client-lambda');
const { v4: uuidv4 } = require('uuid');

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient();
const lambdaClient = new LambdaClient();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
};

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const body = JSON.parse(event.body);
    const { name, description, type, scheduleExpression, executeAt, payload } = body;

    // Validation
    if (!name || !type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'name and type are required fields' })
      };
    }

    if (!['immediate', 'once', 'cron'].includes(type)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid job type. Must be: immediate, once, or cron' })
      };
    }

    if (type === 'once' && !executeAt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'executeAt is required for once type jobs (ISO 8601 format)' })
      };
    }

    if (type === 'cron' && !scheduleExpression) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'scheduleExpression is required for cron type jobs' })
      };
    }

    // Validate executeAt format for once jobs
    if (type === 'once') {
      const executeDate = new Date(executeAt);
      if (isNaN(executeDate.getTime())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid executeAt format. Use ISO 8601 (e.g., 2026-01-15T10:00:00Z)' })
        };
      }
      if (executeDate <= new Date()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'executeAt must be in the future' })
        };
      }
    }

    const jobId = uuidv4();
    const timestamp = Date.now();

    const job = {
      jobId,
      name,
      description: description || '',
      type,
      scheduleExpression: scheduleExpression || null,
      executeAt: executeAt || null,
      payload: payload || {},
      status: type === 'immediate' ? 'executing' : 'scheduled',
      createdAt: timestamp,
      updatedAt: timestamp,
      invocationCount: 0
    };

    // Save job to DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.JOBS_TABLE,
      Item: job
    }));

    console.log('Job saved to DynamoDB:', jobId);

    // Handle different job types
    if (type === 'immediate') {
      console.log('Executing immediate job:', jobId);
      
      // Execute immediately using async invocation
      await lambdaClient.send(new InvokeCommand({
        FunctionName: process.env.JOB_EXECUTOR_FUNCTION_ARN,
        InvocationType: 'Event', // Async invocation
        Payload: JSON.stringify({ jobId, payload })
      }));

      job.status = 'executing';
      
    } else if (type === 'once') {
      const ruleName = `job-${jobId}`;
      const executeDate = new Date(executeAt);
      
      console.log('Creating one-time schedule for:', executeDate.toISOString());
      
      // EventBridge at() expression format
      const atExpression = `at(${executeDate.toISOString().slice(0, 19)})`;
      
      // Create EventBridge rule
      await eventBridgeClient.send(new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: atExpression,
        State: 'ENABLED',
        Description: `One-time job: ${name}`
      }));

      console.log('EventBridge rule created:', ruleName);

      // Add permission for EventBridge to invoke Lambda
      try {
        await lambdaClient.send(new AddPermissionCommand({
          FunctionName: process.env.JOB_EXECUTOR_FUNCTION_ARN,
          StatementId: `${ruleName}-permission`,
          Action: 'lambda:InvokeFunction',
          Principal: 'events.amazonaws.com',
          SourceArn: `arn:aws:events:${process.env.REGION}:*:rule/${ruleName}`
        }));
      } catch (err) {
        if (err.name !== 'ResourceConflictException') {
          throw err;
        }
        console.log('Permission already exists');
      }

      // Add target to rule
      await eventBridgeClient.send(new PutTargetsCommand({
        Rule: ruleName,
        Targets: [{
          Id: '1',
          Arn: process.env.JOB_EXECUTOR_FUNCTION_ARN,
          Input: JSON.stringify({ jobId, payload })
        }]
      }));

      console.log('Target added to rule');
      job.ruleName = ruleName;
      
    } else if (type === 'cron') {
      const ruleName = `job-${jobId}`;
      
      console.log('Creating cron schedule:', scheduleExpression);
      
      // Create EventBridge rule with cron/rate expression
      await eventBridgeClient.send(new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: scheduleExpression,
        State: 'ENABLED',
        Description: `Recurring job: ${name}`
      }));

      console.log('EventBridge rule created:', ruleName);

      // Add permission for EventBridge to invoke Lambda
      try {
        await lambdaClient.send(new AddPermissionCommand({
          FunctionName: process.env.JOB_EXECUTOR_FUNCTION_ARN,
          StatementId: `${ruleName}-permission`,
          Action: 'lambda:InvokeFunction',
          Principal: 'events.amazonaws.com',
          SourceArn: `arn:aws:events:${process.env.REGION}:*:rule/${ruleName}`
        }));
      } catch (err) {
        if (err.name !== 'ResourceConflictException') {
          throw err;
        }
        console.log('Permission already exists');
      }

      // Add target to rule
      await eventBridgeClient.send(new PutTargetsCommand({
        Rule: ruleName,
        Targets: [{
          Id: '1',
          Arn: process.env.JOB_EXECUTOR_FUNCTION_ARN,
          Input: JSON.stringify({ jobId, payload })
        }]
      }));

      console.log('Target added to rule');
      job.ruleName = ruleName;
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'Job created successfully',
        job
      })
    };
    
  } catch (error) {
    console.error('Error creating job:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create job', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};