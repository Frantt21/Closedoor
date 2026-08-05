const GoogleDriveService = require('./google_drive');
const readline = require('readline');
require('dotenv').config({ path: 'lib/backend/.env' });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  let clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  console.log('\n=== Google Drive Refresh Token Generator ===');

  if (!clientId) {
    clientId = await new Promise(resolve => {
      rl.question('Enter your Google Drive Client ID: ', resolve);
    });
  }

  if (!clientSecret) {
    clientSecret = await new Promise(resolve => {
      rl.question('Enter your Google Drive Client Secret: ', resolve);
    });
  }

  // Temporarily set env vars for the service instance
  process.env.GOOGLE_DRIVE_CLIENT_ID = clientId.trim();
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = clientSecret.trim();
  // Use env var or default to user's custom callback
  if (!process.env.GOOGLE_DRIVE_REDIRECT_URI) {
    process.env.GOOGLE_DRIVE_REDIRECT_URI = 'http://api.foranly.space:24725/oauth2callback';
  }

  const driveService = new GoogleDriveService();
  
  // Override auth url generation to ensure correct scope and params
  const oauth2Client = driveService.oauth2Client;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent' // Force new refresh token
  });

  console.log('\n1. Open this URL in your browser:');
  console.log('\n', authUrl, '\n');
  console.log('2. Authorize the app and copy the code provided.');

  const code = await new Promise(resolve => {
    rl.question('3. Paste the code here: ', resolve);
  });

  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n=== SUCCESS ===');
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('\nUpdate your server environment with this new GOOGLE_DRIVE_REFRESH_TOKEN');
  } catch (error) {
    console.error('\nError getting tokens:', error.message);
  } finally {
    rl.close();
  }
}

main();
