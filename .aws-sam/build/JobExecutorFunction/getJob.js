const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

    console.log('Fetching job:', jobId);

    // Get job details
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
    console.log('Job found:', job.name);

    // Get query parameters for invocation filtering
    const queryParams = event.queryStringParameters || {};
    const invocationLimit = queryParams.invocationLimit ? parseInt(queryParams.invocationLimit) : 50;
    const invocationStatus = queryParams.invocationStatus;

    // Query invocations for this job
    let queryInvocationsParams = {
      TableName: process.env.INVOCATIONS_TABLE,
      IndexName: 'JobIdIndex',
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: {
        ':jobId': jobId
      },
      ScanIndexForward: false, // Sort by timestamp descending (newest first)
      Limit: invocationLimit
    };

    // Add filter for invocation status if provided
    if (invocationStatus) {
      queryInvocationsParams.FilterExpression = '#status = :status';
      queryInvocationsParams.ExpressionAttributeNames = { '#status': 'status' };
      queryInvocationsParams.ExpressionAttributeValues[':status'] = invocationStatus;
    }

    console.log('Querying invocations with params:', queryInvocationsParams);

    const invocationsResult = await docClient.send(new QueryCommand(queryInvocationsParams));

    const invocations = invocationsResult.Items || [];
    
    console.log(`Found ${invocations.length} invocations`);

    // Calculate statistics
    const completedInvocations = invocations.filter(inv => inv.status === 'completed');
    const failedInvocations = invocations.filter(inv => inv.status === 'failed');
    const runningInvocations = invocations.filter(inv => inv.status === 'running');

    const averageDuration = completedInvocations.length > 0
      ? completedInvocations.reduce((sum, inv) => sum + (inv.duration || 0), 0) / completedInvocations.length
      : 0;

    const statistics = {
      totalInvocations: invocations.length,
      completed: completedInvocations.length,
      failed: failedInvocations.length,
      running: runningInvocations.length,
      averageDuration: Math.round(averageDuration),
      successRate: invocations.length > 0 
        ? ((completedInvocations.length / invocations.length) * 100).toFixed(2) 
        : 0
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        job,
        invocations,
        statistics
      })
    };
    
  } catch (error) {
    console.error('Error fetching job:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch job', 
        details: error.message 
      })
    };
  }
};