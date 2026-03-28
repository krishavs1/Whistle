/**
 * API smoke test for Whistle frontend routes.
 * Requires `npm run dev` to be running with valid .env config.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function call(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} failed (${res.status}): ${body.error || JSON.stringify(body)}`);
  }
  return body;
}

async function run() {
  console.log(`Running smoke checks against ${BASE_URL}`);

  const agents = await call("/api/agents");
  console.log("OK /api/agents", {
    buyer: agents?.buyer?.address,
    seller: agents?.seller?.address,
    arbitrator: agents?.arbitrator?.address,
  });

  const happyCreate = await call("/api/demo/happy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: "create-task" }),
  });
  console.log("OK happy create-task", {
    taskId: happyCreate.taskId,
    deliverBy: happyCreate.deliverBy,
  });

  const happyDeliver = await call("/api/demo/happy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: "submit-deliverable" }),
  });
  console.log("OK happy submit-deliverable", { cid: happyDeliver.deliverableCid });

  const happyApprove = await call("/api/demo/happy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: "approve" }),
  });
  console.log("OK happy approve", { tx: happyApprove.txHash });

  const rep = await call("/api/reputation");
  console.log("OK /api/reputation", rep);
}

run()
  .then(() => {
    console.log("Smoke test complete.");
  })
  .catch((err) => {
    console.error("Smoke test failed:", err.message);
    process.exit(1);
  });
