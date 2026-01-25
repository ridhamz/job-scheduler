export default function sendSms(to, message) {
  // Simulate sending an SMS
  console.log(`Sending SMS to: ${to}`);
  console.log(`Message: ${message}`);
  return Promise.resolve({ success: true });
}