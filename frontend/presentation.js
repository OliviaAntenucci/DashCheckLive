const button = document.querySelector("#run-check");
const steps = [...document.querySelectorAll(".scan-step")];
const log = document.querySelector("#scanner-log");
const summary = document.querySelector("#summary");
const cleanStatus = document.querySelector("#clean-status");
const inputGroups = [
  [...document.querySelectorAll(".approved-field")],
  [...document.querySelectorAll(".delivery-field")],
  [...document.querySelectorAll(".sensitive-field")],
  [...document.querySelectorAll(".attack-field")],
];
const outputGroups = [
  [...document.querySelectorAll(".approved-output")],
  [...document.querySelectorAll(".delivery-output")],
  [...document.querySelectorAll(".sensitive-output")],
  [...document.querySelectorAll(".attack-output")],
];
const messages = [
  "Packing data approved: burger · fries · ranch · allergy",
  "Delivery identity routed away from the packing view",
  "Card number replaced with [CARD] before AI processing",
  "Injected instruction has no action permission",
];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

button.addEventListener("click", async () => {
  document.body.classList.add("processing");
  steps.forEach((step) => step.className = "scan-step");
  inputGroups.flat().forEach((field) => field.classList.remove("field-active", "field-resolved"));
  outputGroups.flat().forEach((field) => field.classList.remove("output-visible"));
  button.disabled = true;
  button.firstChild.textContent = "Processing ";
  summary.innerHTML = "Inspecting order data…";
  cleanStatus.textContent = "PROCESSING";
  cleanStatus.className = "";

  for (let index = 0; index < steps.length; index += 1) {
    steps[index].className = "scan-step active";
    inputGroups[index].forEach((field) => field.classList.add("field-active"));
    log.textContent = `STEP ${index + 1}/4  ${messages[index]}`;
    await wait(1600);
    inputGroups[index].forEach((field) => {
      field.classList.remove("field-active");
      field.classList.add("field-resolved");
    });
    outputGroups[index].forEach((field) => field.classList.add("output-visible"));
    steps[index].className = "scan-step done";
    await wait(500);
  }

  log.textContent = "COMPLETE  Clean packing data created · staff confirmation still required";
  summary.innerHTML = "<b>4</b> approved · <b>2</b> protected · <b>2</b> blocked";
  cleanStatus.textContent = "CLEAN";
  cleanStatus.className = "ready";
  button.disabled = false;
  button.firstChild.textContent = "Run again ";
});
