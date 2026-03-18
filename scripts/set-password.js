#!/usr/bin/env node
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter admin password: ', async (password) => {
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const auth = require('../src/auth');
  await auth.setPassword(password);
  console.log('Admin password set successfully.');
  process.exit(0);
});
