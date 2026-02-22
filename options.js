const status = document.getElementById("status");

// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['apiKey', 'model'], (items) => {
        if (items.apiKey) document.getElementById('apiKey').value = items.apiKey;
        if (items.model) {
            // Add saved model to list if it exists
            const select = document.getElementById('model');
            const option = document.createElement("option");
            option.value = items.model;
            option.text = items.model + " (Saved)";
            option.selected = true;
            select.add(option);
        }
    });
});

// FETCH MODELS BUTTON
document.getElementById('fetchModels').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value;
    if (!apiKey) {
        alert("Please enter API Key first");
        return;
    }

    status.textContent = "Fetching models...";
    status.style.color = "blue";

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);
        if (!data.models) throw new Error("No models found.");

        const select = document.getElementById('model');
        select.innerHTML = ""; // Clear list

        // Filter for 'generateContent' supported models
        const validModels = data.models.filter(m => 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes("generateContent")
        );

        validModels.forEach(m => {
            const option = document.createElement("option");
            // Strip 'models/' prefix for cleaner display, but value keeps it if needed
            option.value = m.name.replace("models/", ""); 
            option.text = m.displayName + " (" + m.name.replace("models/", "") + ")";
            select.appendChild(option);
        });

        status.textContent = `Success! Loaded ${validModels.length} models.`;
        status.style.color = "green";
    } catch (e) {
        status.textContent = "Error: " + e.message;
        status.style.color = "red";
    }
});

document.getElementById('save').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value;
    
    if (!model) {
        alert("Please select a model!");
        return;
    }

    chrome.storage.sync.set({ apiKey, model }, () => {
        status.textContent = "Settings Saved!";
        setTimeout(() => status.textContent = "", 2000);
    });
});