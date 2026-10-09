const { Client } = require('pg');
async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
  });

  await client.connect();

  try {
    await client.query("CREATE USER support_user WITH PASSWORD 'support_pass';");
  } catch (e) {
    console.log('User may exist:', e.message);
  }

  try {
    await client.query("CREATE DATABASE support_chat OWNER support_user;");
  } catch (e) {
    console.log('DB may exist:', e.message);
  }

  console.log('Done');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
