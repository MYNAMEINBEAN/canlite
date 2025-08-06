if (localStorage.getItem('token')) {
    let token = localStorage.getItem('token');

    fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
    })
        .then(response => {
            if (response.status === 200) {
                document.getElementById('loginModalBtn').innerHTML =
                    `<span id="loginSpan" class="material-symbols-outlined">logout</span>Logout`;
            } else {
                localStorage.removeItem('token');
                alert("Session expired");
            }
        })
        .catch(error => {
            console.error("Error:", error);
            alert("Failed to verify session");
        });
}

if (['canlite.online', 'everyonegetsnews.org'].includes(location.hostname)) {
    const storageKey = 'lastAlertTime';
    const alertMessage = "This link will expire soon, please join the discord for a new one";
    const currentTime = new Date().getTime();
    const lastAlertTime = parseInt(localStorage.getItem(storageKey) || '0');
    const hoursSinceLast = (currentTime - lastAlertTime) / (1000 * 60 * 60);

    if (hoursSinceLast >= 24 || lastAlertTime==='0') {
        alert(alertMessage);
        localStorage.setItem(storageKey, currentTime.toString());
    }
}

const popunderURL = "https://" + window.location.hostname + "/advein";
const localStorageKey = "lastPopunderTime";
const interval = 30 * 60 * 1000; // 30 minutes in milliseconds

function shouldOpenPopunder() {
    const lastTime = parseInt(localStorage.getItem(localStorageKey), 10) || 0;
    const now = Date.now();
    return ((now - lastTime) >= interval) && (window.location.pathname !== "/");
}

function openPopunder() {
    const newWin = window.open(popunderURL, "_blank");
    if (!newWin) return; // blocked by browser

    // Attempt to create popunder effect
    newWin.blur();
    window.focus();

    // Save the time
    localStorage.setItem(localStorageKey, Date.now().toString());
}

// Trigger only on user interaction
document.addEventListener("click", function handler() {
    if (shouldOpenPopunder()) {
        openPopunder();
    }
    document.removeEventListener("click", handler); // trigger only once per page load
});

const modal = document.getElementById("authModal");
const btn = document.getElementById("loginModalBtn");
const closeBtn = document.getElementsByClassName("close")[0];
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

// Open the modal when the button is clicked
btn.onclick = function() {
    if(localStorage.getItem('token')) {
        localStorage.removeItem('token');
        fetch("/api/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        })
            .then(response => response.json())
        location.reload();
    } else {
        modal.style.display = "block";
    }
}

// Close the modal when the close icon is clicked
closeBtn.onclick = function() {
    modal.style.display = "none";
}

// Close the modal when clicking outside the modal content
window.onclick = function(event) {
    if (event.target === modal) {
        modal.style.display = "none";
    }
}

// Tab switching logic
loginTab.onclick = function() {
    loginTab.classList.add("active");
    registerTab.classList.remove("active");
    loginForm.style.display = "block";
    registerForm.style.display = "none";
}

registerTab.onclick = function() {
    registerTab.classList.add("active");
    loginTab.classList.remove("active");
    loginForm.style.display = "none";
    registerForm.style.display = "block";
}

document.querySelector("#loginForm form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const result = await response.text();

        if(result === "acc") {
            alert("Account does not exist. Please register.");
        } else if(result === "pass") {
            alert("Incorrect password");
        } else {
            // Optionally store the token for subsequent authenticated requests
            document.getElementById('loginStatus').innerHTML = `<p>Logged in. Loading game data.</p>`;
            fetch(`https://${window.location.host}/api/loadGameData`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result }),
            })
                .then(response => response.json())
                .then(data => {
                    if (data.gameData) {
                        const storageData = JSON.parse(data.gameData);
                        localStorage.clear()
                        for (const key in storageData) {
                            localStorage.setItem(key, storageData[key]);
                        }
                        document.getElementById('loginModalBtn').innerHTML = `<span id="loginSpan" class="material-symbols-outlined">logout</span>Logout`;
                        console.log("LocalStorage data loaded:", storageData);
                        localStorage.setItem("token", result);
                        modal.style.display = "none";
                        window.location.reload();
                    }
                })
        }
    } catch (error) {
        console.error("Login error:", error);
        alert("Login failed. Please try again.");
    }
});

// Handle Register Form Submission
document.querySelector("#registerForm form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const email = document.getElementById("registerEmail").value;
    const password = document.getElementById("registerPassword").value;

    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const token = await response.text();

        if(token === "exists") {
            alert("Account already exists. Please log in.");
        } else {
            document.getElementById('loginModalBtn').innerHTML = `<span id="loginSpan" class="material-symbols-outlined">logout</span>Logout`;
            const localStorageData = { ...localStorage }; // Clone localStorage as an object
            delete localStorageData.token;
            fetch("https://" + window.location.hostname + `/api/saveGameData`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, localStorageData }),
            })
                .then(response => response.json())
                .then(data => {
                    console.log("LocalStorage data saved:", data);
                    localStorage.setItem("token", token);
                    modal.style.display = "none";
                    alert("Registration successful.");
                })
                .catch(error => console.error("Error saving localStorage data:", error));
        }
    } catch (error) {
        console.error("Registration error:", error);
        alert("Registration failed. Please try again.");
    }
});