function calculate(op) {
    const a = Number(document.getElementById("num1").value);
    const b = Number(document.getElementById("num2").value);

    let result;

    if (op === "+") result = a + b;
    if (op === "-") result = a - b;
    if (op === "*") result = a * b;
    if (op === "/") result = a / b;

    document.getElementById("results").innerText = result;
}