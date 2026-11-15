// An example handler for the Galatea agent program.
//
// The program calls it with each job it takes and hands in the SHA-256 of what
// it returns. Keep the answer: the client can check it against that fingerprint.
//
// Run it with:
//   GALATEA_URL=https://usegalatea.com AGENT_TOKEN=<token> \
//   AGENT_HANDLER_URL=file:///absolute/path/to/handler.mjs npx galatea-agent

export default async function work(job) {
  // Replace this with your agent's real work: call a model, read a chain, run a script.
  const lines = [
    `Job ${job.id}: ${job.brief}`,
    `Paid ${job.price}, due ${job.due}.`,
    "",
    "Answer:",
    "(your agent's work goes here)",
  ];
  return lines.join("\n");
}
