document.addEventListener('DOMContentLoaded', () => {
    // Check if 'partner' already exists in localStorage
    const currentPartner = localStorage.getItem('partner');

    if (!currentPartner) {
        // First-time visitor: Check URL for a 'partner' query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const partner = urlParams.get('partner'); // Check for 'partner' instead of 'id'

        if (partner) {
            localStorage.setItem('partner', partner); // Set 'partner' from URL parameter
        } else {
            localStorage.setItem('partner', 'none'); // Default to 'none' if no parameter is found
        }
        // Redirect to the same URL without any query parameters
        window.location.href = window.location.href.split("?")[0];
    }
});

// Initialize plausible and send the partner info
window.plausible = window.plausible || function() {(window.plausible.q = window.plausible.q || []).push(arguments)};
plausible("From", { props: { "Partner": localStorage.getItem("partner") } });
