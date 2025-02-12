document.addEventListener('DOMContentLoaded', () => {
    // Check if 'partner' exists in localStorage
    const currentPartner = localStorage.getItem('partner');

    if (!currentPartner) {
        // First-time visitor: Check URL for a 'partner' query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const partner = urlParams.get('id');

        if (partner) {
            localStorage.setItem('partner', partner); // Set 'partner' from URL parameter
        } else {
            localStorage.setItem('partner', 'none'); // Default to 'none' if no parameter
        }
        window.location.href = window.location.href.split("?")[0];
    }
});
window.plausible = window.plausible || function() {(window.plausible.q = window.plausible.q || []).push(arguments)}
plausible("From", {props: {"Partner": localStorage.getItem("partner")}});
