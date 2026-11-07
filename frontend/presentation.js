const button = document.querySelector("#run-check");

button.addEventListener("click", () => {
  const checked = document.body.classList.toggle("checked");
  button.firstChild.textContent = checked ? "Reset demo " : "Run security check ";
  document.querySelector("#pii-count").textContent = checked ? "0 fields" : "—";
  document.querySelector("#seal-access").textContent = checked ? "No" : "—";
});
