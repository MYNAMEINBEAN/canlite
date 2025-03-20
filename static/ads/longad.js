(function() {
    if(window.location.hostname.includes(".org") || window.location.hostname.includes("psybolt")) {
        var adsenseScript = document.createElement('script');
        adsenseScript.async = true;
        adsenseScript.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1655414789495559';
        adsenseScript.crossOrigin = 'anonymous';
        document.head.appendChild(adsenseScript);

        adsenseScript.onload = function() {
            var adContainer = document.createElement('ins');
            adContainer.className = 'adsbygoogle';
            adContainer.style.display = 'inline-block';
            adContainer.style.width = '38vw';  // 728px converted to approximately 38vw
            adContainer.style.height = '4.7vw';  // 90px converted to approximately 4.7vw
            adContainer.setAttribute('data-ad-client', 'ca-pub-1655414789495559');
            adContainer.setAttribute('data-ad-slot', '7667513704');

            var scriptContainer = document.querySelector('.script-container1');
            if (scriptContainer) {
                scriptContainer.appendChild(adContainer);
                (adsbygoogle = window.adsbygoogle || []).push({});
            }
        };
    }
})();