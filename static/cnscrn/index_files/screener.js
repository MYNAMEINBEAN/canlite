async function solvePoW(challenge, difficulty) {
    // Convert difficulty to number
    difficulty = parseInt(difficulty);

    // Create a prefix of zeros to match
    const prefix = '0'.repeat(difficulty);

    // Solve the PoW challenge
    let nonce = 0;
    while (nonce < 10000000) { // Safety limit
        // Create a hash of challenge + nonce
        const msgBuffer = new TextEncoder().encode(challenge + nonce);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Check if the hash meets the difficulty requirement
        if (hashHex.startsWith(prefix)) {
            return nonce;
        }

        nonce++;

        // Yield to the browser every 1000 iterations
        if (nonce % 1000 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    throw new Error('Could not find solution');
}

// Solve the PoW and submit the solution
async function runVerification() {
    try {
        const challenge = "INSERTCHALLENGE";
        const difficulty = "INSERTDIFFICULTY";

        const solution = await solvePoW(challenge, difficulty);

        // Submit the solution to the server
        const response = await fetch('/cnscrn/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ solution: solution.toString() }),
            credentials: 'include' // This is crucial for sending cookies
        });

        const result = await response.json();

        if (result.success) {
            console.log("Verification successful, redirecting...");

            // Use a more reliable method to ensure the session is saved
            // Redirect after a short delay to allow the session to be saved
            setTimeout(() => {
                window.location.href = '/';
            }, 500);
        } else {
            throw new Error('Server rejected solution: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Verification failed:', error);
        // Reload the page to get a new challenge
        setTimeout(() => {
            location.reload();
        }, 2000);
    }
}

// Start the verification process
runVerification();