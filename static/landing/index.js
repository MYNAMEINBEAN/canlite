var appElement = document.getElementById('app');
var typewriter = new Typewriter(appElement, {
    loop: true,
    delay: 75,
});
typewriter
    .typeString('Fast, Secure & Anonymous Browsing')
    .pauseFor(2000)
    .deleteAll()
    .typeString('Play Unblocked Games Anywhere!')
    .pauseFor(2000)
    .deleteAll()
    .typeString('Experience CanLite – Your Ultimate Proxy & Gaming Hub')
    .pauseFor(2000)
    .start();

// Panic Key Functionality
var panicKey = localStorage.getItem('panicKey');
var panicWebsite = localStorage.getItem('panicWebsite');
$(document).keydown(function (e) {
    if (e.key === panicKey) {
        window.location.href = panicWebsite;
    }
});

// Set current year in the footer
document.getElementById('year').textContent = new Date().getFullYear();