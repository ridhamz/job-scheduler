const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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
    // Get query parameters for filtering
    const queryParams = event.queryStringParameters || {};
    const type = queryParams.type;
    const status = queryParams.status;
    const limit = queryParams.limit ? parseInt(queryParams.limit) : 100;

    let scanParams = {
      TableName: process.env.JOBS_TABLE,
      Limit: limit
    };

    // Add filters if provided
    let filterExpressions = [];
    let expressionAttributeValues = {};
    let expressionAttributeNames = {};

    if (type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = type;
    }

    if (status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
    }

    if (filterExpressions.length > 0) {
      scanParams.FilterExpression = filterExpressions.join(' AND ');
      scanParams.ExpressionAttributeValues = expressionAttributeValues;
      scanParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    console.log('Scanning jobs table with params:', scanParams);

    const result = await docClient.send(new ScanCommand(scanParams));

    // Sort jobs by creation date (newest first)
    const jobs = (result.Items || []).sort((a, b) => b.createdAt - a.createdAt);

    console.log(`Found ${jobs.length} jobs`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count: jobs.length,
        jobs,
        scannedCount: result.ScannedCount
      })
    };
    
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch jobs', 
        details: error.message 
      })
    };
  }
};