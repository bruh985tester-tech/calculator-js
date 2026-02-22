const log = document.getElementById("log");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
let keepRunning = false;

function write(msg, type = "") {
    const div = document.createElement("div");
    div.textContent = msg;
    if (type) div.className = type;
    div.style.padding = "2px 0";
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// --- 1. VISUAL SCANNER (CSS FIX: OUTLINES ONLY) ---
function DOMScanner(showOverlays) {
    // Clear previous highlights
    document.querySelectorAll(".nano-overlay").forEach(el => el.remove());

    function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.nodeName.toLowerCase();
            if (current.parentElement) {
                let siblings = Array.from(current.parentElement.children);
                if (siblings.length > 1) {
                    let index = siblings.indexOf(current) + 1;
                    selector += ':nth-child(' + index + ')';
                }
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    const targets = document.querySelectorAll("input, button, a[href], textarea, select, [role='button'], [role='checkbox'], label, div[role='button']");
    
    const visibleTargets = Array.from(targets).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight;
    });

    const elements = visibleTargets.slice(0, 70).map((el, index) => {
        let text = (el.innerText || "").substring(0, 50).replace(/\n/g, " ").trim();
        let placeholder = (el.placeholder || "").substring(0, 30);
        let label = (el.getAttribute("aria-label") || "").substring(0, 30);
        
        const selector = getUniqueSelector(el);

        // --- DRAW VISUAL BOX (TRANSPARENT) ---
        if (showOverlays) {
            const rect = el.getBoundingClientRect();
            const div = document.createElement("div");
            div.className = "nano-overlay";
            div.style.position = "fixed";
            div.style.left = rect.left + "px";
            div.style.top = rect.top + "px";
            div.style.width = rect.width + "px";
            div.style.height = rect.height + "px";
            
            // HERE IS THE FIX: Transparent background, Red Border
            div.style.border = "2px solid #ff0000"; 
            div.style.backgroundColor = "transparent"; 
            
            div.style.zIndex = "999999";
            div.style.pointerEvents = "none";
            
            // Number Badge
            const badge = document.createElement("div");
            badge.innerText = index;
            badge.style.position = "absolute";
            badge.style.top = "-15px";
            badge.style.left = "0";
            badge.style.background = "red";
            badge.style.color = "white";
            badge.style.fontSize = "10px";
            badge.style.padding = "1px 4px";
            badge.style.fontWeight = "bold";
            div.appendChild(badge);

            document.body.appendChild(div);
        }

        return {
            index: index,
            tag: el.tagName,
            text: text || placeholder || label || "[No Text]",
            sel: selector
        };
    });

    return elements;
}

// --- 2. BRAIN ---
async function callGemini(goal, domElements, apiKey, modelName) {
    let fullModelName = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${fullModelName}:generateContent?key=${apiKey}`;

    const prompt = `
    YOU ARE A BROWSER AGENT.
    USER GOAL: "${goal}"
    
    VISIBLE ELEMENTS:
    ${JSON.stringify(domElements.map(e => `${e.index}: <${e.tag}> ${e.text}`)) }
    
    INSTRUCTIONS:
    1. Select the index of the element that best advances the goal.
    2. To filter (e.g. price, stars), find the sidebar checkboxes/links.
    3. If target is NOT visible, return "scroll".
    4. If goal is met, return "finish".

    RESPONSE FORMAT (JSON ONLY):
    {
      "reasoning": "string",
      "action": "click" | "type" | "scroll" | "finish",
      "target_index": number,
      "value": "string" (only for type)
    }
    `;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        
        let rawText = data.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(rawText);
    } catch (e) {
        throw e;
    }
}

// --- 3. EXECUTION LOOP ---
runBtn.onclick = async () => {
    keepRunning = true;
    runBtn.style.display = "none";
    stopBtn.style.display = "block";
    log.innerHTML = "";
    
    const goal = document.getElementById("prompt").value;
    const showBoxes = document.getElementById("show-boxes").checked;
    
    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) {
        write("âŒ No API Key found.", "error");
        keepRunning = false;
        return;
    }
    
    const selectedModel = model || "gemini-1.5-flash";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    write(`ðŸŽ¯ Goal: "${goal}"`, "user");

    for (let step = 1; step <= 15; step++) {
        if (!keepRunning) break;
        write(`\nðŸ”„ Step ${step}...`, "debug");

        try {
            // 1. SCAN
            const scanResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: DOMScanner,
                args: [showBoxes]
            });
            const elements = scanResults[0].result;
            write(`ðŸ‘ï¸ Seeing ${elements.length} elements.`);

            // 2. THINK
            const plan = await callGemini(goal, elements, apiKey, selectedModel);
            write(`ðŸ¤– ${plan.reasoning}`, "ai");

            if (plan.action === "finish") {
                write("âœ… Task Complete!", "ai");
                break;
            }

            if (plan.action === "scroll") {
                write("â¬‡ï¸ Scrolling...", "debug");
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => window.scrollBy({ top: 600, behavior: 'smooth' })
                });
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            // 3. ACT
            if (typeof plan.target_index === "number") {
                const target = elements.find(e => e.index === plan.target_index);
                if (target) {
                    write(`ðŸ”§ ${plan.action.toUpperCase()} -> [${target.text}]`, "debug");
                    
                    // --- FIX FOR SERIALIZATION ERROR ---
                    // We ensure 'value' is never undefined. We send "" if it's missing.
                    const safeValue = plan.value || ""; 

                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (sel, action, value) => {
                            const el = document.querySelector(sel);
                            if (!el) return;
                            el.focus();
                            if (action === "type") {
                                el.value = value;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                                const form = el.closest('form');
                                if (form) setTimeout(() => form.submit(), 200);
                            } else {
                                el.click();
                            }
                        },
                        args: [target.sel, plan.action, safeValue] // <--- THE FIX
                    });
                    
                    await new Promise(r => setTimeout(r, 4000));
                } else {
                    write("â” Error: Target index " + plan.target_index + " not found.", "error");
                }
            }
        } catch (err) {
            write("âŒ Error: " + err.message, "error");
            break; // Stop on error so you can see it
        }
    }

    stopBtn.style.display = "none";
    runBtn.style.display = "block";
    write("âœ‹ Agent stopped.");
};

stopBtn.onclick = () => {
    keepRunning = false;
    write("ðŸ›‘ Stopping...");
};