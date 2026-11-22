import { Client } from "pg";

const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
});
await c.connect();
const b = await c.query(
    "select user_address, balance from projection_punch_balance order by balance desc limit 3",
);
const s = await c.query("select projection, paused from projection_status");
console.log("balances:", JSON.stringify(b.rows));
console.log("status:", JSON.stringify(s.rows));
await c.end();
