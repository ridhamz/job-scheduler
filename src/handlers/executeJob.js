const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, RemoveTargetsCommand, DeleteRuleCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, RemovePermissionCommand } = require('@aws-sdk/client-lambda');
const { v4: uuidv4 } = require('uuid');
const { executeJobLogic } = require('./jobLogic');

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient();
const lambdaClient = new LambdaClient();

exports.handler = async (event) => {
  console.log('Job Executor - Received event:', JSON.stringify(event, null, 2));

  const invocationId = uuidv4();
  const timestamp = Date.now();
  let jobId, payload;

  try {
    // Parse the event - can come from EventBridge or direct Lambda invocation
    if (event.jobId) {
      jobId = event.jobId;
      payload = event.payload || {};
    } else {
      console.error('Invalid event format - missing jobId');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid event format - jobId required' })
      };
    }

    console.log(`Executing job: ${jobId}`);

    // Get job details from DynamoDB
    const jobResult = await docClient.send(new GetCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId }
    }));

    if (!jobResult.Item) {
      console.error('Job not found:', jobId);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    const job = jobResult.Item;
    console.log(`Job found: ${job.name} (Type: ${job.type})`);

    const startTime = Date.now();

    // Create invocation record with 'running' status
    const invocation = {
      invocationId,
      jobId,
      timestamp,
      status: 'running',
      startedAt: startTime,
      input: payload
    };

    await docClient.send(new PutCommand({
      TableName: process.env.INVOCATIONS_TABLE,
      Item: invocation
    }));

    console.log(`Invocation record created: ${invocationId}`);

    // Execute the actual job logic
    let result;
    let executionError = null;

    try {
      result = await executeJobLogic(job, payload);
      console.log('Job logic executed successfully');
    } catch (error) {
      console.error('Error in job logic execution:', error);
      executionError = error;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Update invocation with result
    if (executionError) {
      invocation.status = 'failed';
      invocation.completedAt = endTime;
      invocation.duration = duration;
      invocation.error = executionError.message;
      invocation.errorStack = executionError.stack;
    } else {
      invocation.status = 'completed';
      invocation.completedAt = endTime;
      invocation.duration = duration;
      invocation.output = result;
    }

    await docClient.send(new PutCommand({
      TableName: process.env.INVOCATIONS_TABLE,
      Item: invocation
    }));

    console.log(`Invocation updated: ${invocation.status}`);

    // Update job metadata
    const updateExpression = 'SET invocationCount = invocationCount + :inc, lastExecutedAt = :timestamp, updatedAt = :timestamp';
    const expressionAttributeValues = {
      ':inc': 1,
      ':timestamp': timestamp
    };

    // Update status based on job type and execution result
    let newStatus = job.status;
    if (job.type === 'immediate') {
      newStatus = executionError ? 'failed' : 'completed';
    } else if (job.type === 'once') {
      newStatus = executionError ? 'failed' : 'completed';
    } else if (job.type === 'cron') {
      newStatus = 'scheduled'; // Cron jobs remain scheduled
    }

    await docClient.send(new UpdateCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: updateExpression + ', #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':status': newStatus
      }
    }));

    console.log(`Job metadata updated. New status: ${newStatus}`);

    // For one-time jobs, delete the EventBridge rule after execution
    if (job.type === 'once' && job.ruleName) {
      try {
        console.log(`Cleaning up one-time job rule: ${job.ruleName}`);

        await eventBridgeClient.send(new RemoveTargetsCommand({
          Rule: job.ruleName,
          Ids: ['1']
        }));

        await eventBridgeClient.send(new DeleteRuleCommand({
          Name: job.ruleName
        }));

        try {
          await lambdaClient.send(new RemovePermissionCommand({
            FunctionName: process.env.JOB_EXECUTOR_FUNCTION_ARN,
            StatementId: `${job.ruleName}-permission`
          }));
          console.log('Lambda permission removed');
        } catch (err) {
          console.log('Error removing permission (might not exist):', err.message);
        }

        console.log('EventBridge rule deleted successfully');
      } catch (err) {
        console.error('Error cleaning up EventBridge rule:', err);
      }
    }

    // Return success or failure based on execution
    if (executionError) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Job execution failed',
          invocationId,
          jobId,
          duration,
          error: executionError.message
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Job executed successfully',
        invocationId,
        jobId,
        duration,
        result
      })
    };
    
  } catch (error) {
    console.error('Critical error executing job:', error);

    // Try to record failed invocation
    try {
      await docClient.send(new PutCommand({
        TableName: process.env.INVOCATIONS_TABLE,
        Item: {
          invocationId,
          jobId: jobId || 'unknown',
          timestamp,
          status: 'failed',
          startedAt: timestamp,
          completedAt: Date.now(),
          duration: Date.now() - timestamp,
          error: error.message,
          errorStack: error.stack
        }
      }));
    } catch (dbError) {
      console.error('Error recording failed invocation:', dbError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Job execution failed', 
        details: error.message,
        invocationId
      })
    };
  }
};