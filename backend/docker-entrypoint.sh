#!/bin/sh
# Container entrypoint: wait for Postgres, apply the idempotent schema, optionally
# seed the superadmin/default tenant, then start the API server.
set -e

DB_WAIT_ATTEMPTS=30

echo "[entrypoint] waiting for database ${DB_HOST}:${DB_PORT} ..."
i=0
until node -e "const{Pool}=require('pg');const p=new Pool({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});p.query('select 1').then(()=>{p.end();process.exit(0)}).catch(()=>{p.end();process.exit(1)})"; do
  i=$((i + 1))
  if [ "$i" -ge "$DB_WAIT_ATTEMPTS" ]; then
    echo "[entrypoint] database not reachable after ${DB_WAIT_ATTEMPTS} attempts, aborting"
    exit 1
  fi
  sleep 2
done

echo "[entrypoint] applying schema (idempotent) ..."
node -e "require('dotenv').config();const{Pool}=require('pg');const fs=require('fs');const p=new Pool({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const sql=fs.readFileSync('./src/db/schema/init.sql','utf8');p.query(sql).then(()=>{console.log('Migration done');p.end()}).catch(e=>{console.error(e);p.end();process.exit(1)})"

if [ "${RUN_SEED}" = "true" ]; then
  echo "[entrypoint] seeding superadmin / default tenant (idempotent) ..."
  node dist/db/seed.js || echo "[entrypoint] seed failed (continuing anyway)"
fi

echo "[entrypoint] starting server ..."
exec node dist/server.js
