const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutRuleCommand, PutTargetsCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, InvokeCommand, AddPermissionCommand } = require('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../createJob');

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);
const lambdaMock = mockClient(LambdaClient);

describe('createJob', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    lambdaMock.reset();
    process.env.JOBS_TABLE = 'JobsTable';
    process.env.JOB_EXECUTOR_FUNCTION_ARN = 'arn:aws:lambda:region:account:function:executor';
    process.env.REGION = 'us-east-1';
  });

  test('should return 400 if name is missing', async () => {
    const event = {
      body: JSON.stringify({
        type: 'immediate'
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('name and type are required fields');
  });

  test('should return 400 if type is invalid', async () => {
    const event = {
      body: JSON.stringify({
        name: 'test-job',
        type: 'invalid-type'
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Invalid job type');
  });

  test('should create an immediate job successfully', async () => {
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({});

    const event = {
      body: JSON.stringify({
        name: 'test-job',
        type: 'immediate',
        payload: { key: 'value' }
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    
    // Verify DynamoDB put
    expect(ddbMock.calls()).toHaveLength(1);
    const putArgs = ddbMock.call(0).args[0].input;
    expect(putArgs.TableName).toBe('JobsTable');
    expect(putArgs.Item.name).toBe('test-job');
    expect(putArgs.Item.status).toBe('executing');

    // Verify Lambda invoke
    expect(lambdaMock.calls()).toHaveLength(1);
    const invokeArgs = lambdaMock.call(0).args[0].input;
    expect(invokeArgs.FunctionName).toBe(process.env.JOB_EXECUTOR_FUNCTION_ARN);
    expect(invokeArgs.InvocationType).toBe('Event');
  });

  test('should create a once job successfully', async () => {
    ddbMock.on(PutCommand).resolves({});
    ebMock.on(PutRuleCommand).resolves({});
    ebMock.on(PutTargetsCommand).resolves({});
    lambdaMock.on(AddPermissionCommand).resolves({});

    const futureDate = new Date(Date.now() + 100000).toISOString();
    const event = {
      body: JSON.stringify({
        name: 'test-job',
        type: 'once',
        executeAt: futureDate
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);

    // Verify EventBridge rule creation
    expect(ebMock.commandCalls(PutRuleCommand)).toHaveLength(1);
    expect(ebMock.commandCalls(PutTargetsCommand)).toHaveLength(1);
    
    // Verify Permission added
    expect(lambdaMock.commandCalls(AddPermissionCommand)).toHaveLength(1);
  });
});
