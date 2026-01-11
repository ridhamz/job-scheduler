const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, RemoveTargetsCommand, DeleteRuleCommand, ListTargetsByRuleCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, RemovePermissionCommand } = require('@aws-sdk/client-lambda');

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
    const jobId = event.pathParameters?.jobId;

    if (!jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'jobId is required' })
      };
    }

    console.log('Deleting job:', jobId);

    // Get job to check if it exists and get rule name
    const jobResult = await docClient.send(new GetCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId }
    }));

    if (!jobResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    const job = jobResult.Item;
    console.log('Job found:', job.name, 'Type:', job.type);

    // Delete EventBridge rule if it exists (for once and cron jobs)
    if (job.ruleName && (job.type === 'once' || job.type === 'cron')) {
      try {
        console.log('Deleting EventBridge rule:', job.ruleName);

        const targetsResult = await eventBridgeClient.send(new ListTargetsByRuleCommand({
          Rule: job.ruleName
        }));

        if (targetsResult.Targets && targetsResult.Targets.length > 0) {
          const targetIds = targetsResult.Targets.map(t => t.Id);
          console.log('Removing targets:', targetIds);
          
          await eventBridgeClient.send(new RemoveTargetsCommand({
            Rule: job.ruleName,
            Ids: targetIds
          }));
        }

        await eventBridgeClient.send(new DeleteRuleCommand({
          Name: job.ruleName
        }));

        console.log('EventBridge rule deleted');

        try {
          await lambdaClient.send(new RemovePermissionCommand({
            FunctionName: process.env.JOB_EXECUTOR_FUNCTION_ARN,
            StatementId: `${job.ruleName}-permission`
          }));
          console.log('Lambda permission removed');
        } catch (err) {
          console.log('Error removing Lambda permission (might not exist):', err.message);
        }
        
      } catch (err) {
        if (err.name === 'ResourceNotFoundException') {
          console.log('EventBridge rule not found, continuing with deletion');
        } else {
          console.error('Error deleting EventBridge rule:', err);
        }
      }
    }

    await docClient.send(new DeleteCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId }
    }));

    console.log('Job deleted successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Job deleted successfully',
        jobId,
        jobName: job.name
      })
    };
    
  } catch (error) {
    console.error('Error deleting job:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to delete job', 
        details: error.message 
      })
    };
  }
};