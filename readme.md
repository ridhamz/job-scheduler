# 🕒 Serverless Job Scheduler

**Welcome!** This is your go-to solution for scheduling tasks in the cloud without the headache of managing servers. Think of it as your reliable digital assistant that never sleeps and always remembers to run your tasks on time.

Whether you need to send weekly reports, clean up old database records, or sync data between services, this project makes it super easy using **AWS Lambda** and **EventBridge (CloudWatch Events)**.

## 🤔 Why use this?

Running cron jobs usually means setting up a server, configuring `crontab`, and then worrying about that server going down. 

**There's a better way:**
- **Zero Servers**: No EC2 instances to patch or restart.
- **Pay-per-use**: You only pay when your job actually runs.
- **Scalable**: Whether you have 1 job or 1,000, AWS handles the heavy lifting.
- **Simple**: Just write a JavaScript function and say "run this every Friday."

## 🚀 Let's Get You Started

### What you'll need
Before we dive in, make sure you have these friendly tools ready on your machine:
- **Node.js** (v14 or newer) - The engine for our code.
- **AWS CLI** - To talk to your AWS account.
- **AWS SAM CLI** - The magic wand that builds and deploys your serverless apps.

### Installation
1.  **Clone this repo** (get a copy on your machine):
    ```bash
    git clone https://github.com/ridhamz/job-scheduler.git
    cd job-scheduler
    ```

2.  **Install the power-ups** (dependencies):
    ```bash
    npm install
    ```

## 🛠️ How to Build & Deploy

Ready to launch? It's easier than you think!

1.  **Build the project**:
    This prepares your code for the cloud.
    ```bash
    sam build
    ```

2.  **Deploy to AWS**:
    This sends your code up to the cloud. You'll be asked a few simple questions (like what to name your stack).
    ```bash
    sam deploy --guided
    ```
    *Tip: Just hit Enter to accept the defaults if you're not sure!*

## 📝 Creating Your Own Job

Want to schedule something new? Here is how:

1.  **Write the Code**:
    Go to `src/handlers/` and create a new file (e.g., `myAwesomeJob.js`).
    ```javascript
    exports.handler = async () => {
      console.log("Look at me, I'm running in the cloud! ☁️");
      // Your logic goes here (send email, update DB, etc.)
    };
    ```

2.  **Tell the Scheduler**:
    Open `template.yml` and add your function. It's like adding an appointment to a calendar.
    ```yaml
    MyAwesomeJob:
      Type: AWS::Serverless::Function
      Properties:
        Handler: src/handlers/myAwesomeJob.handler
        Events:
          RunEveryMorning:
            Type: Schedule
            Properties:
              Schedule: cron(0 8 * * ? *) # Runs at 8:00 AM every day
    ```

## 🧪 Testing

We believe in reliable code! You can run tests locally to make sure everything is working perfectly.

```bash
npm test
```
*We've included unit tests to keep bugs away!*

## 🤝 Contributing

Got a cool idea? Found a bug? We'd love your help!
Feel free to open an issue or submit a pull request. This is a community project, and your input is valuable.

## 📄 License

This project is open source and available under the ISC License. Go build something amazing!
