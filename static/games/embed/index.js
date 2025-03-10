"use strict"; (async ({ window: win, document: doc }) => {
    if (doc.readyState !== "complete") {
        await new Promise((resolve) => {
            const callback = () => {
                if (doc.readyState === "complete") {
                    doc.removeEventListener("readystatechange", callback);
                    setTimeout(resolve, 1000, null);
                }
            };
            doc.addEventListener("readystatechange", callback, { passive: true });
        });
    }

    const body = doc.body;

    win.stop();
    win.focus();
    body.innerHTML = "Loading... (1)";

    let params = new URLSearchParams(doc.location.search);
    let gamecontent = params.get("content")
    let gametype = params.get("gameid")

    async function u(t) {
        let n = 0
            , r = 0;
        const o = [];
        for (const e of t.split(",")) {
            const t = e.split(";", 3);
            if (3 !== t.length)
                throw Error("Invalid entry value");
            const n = parseInt(t[1], 10)
                , a = parseInt(t[2], 10)
                , i = a - n;
            if (n < 0 || a < 0 || i <= 0)
                throw Error("Invalid entry data length");
            r += i,
                o.push({
                    id: t[0],
                    s: n,
                    e: a,
                    l: i
                })
        }
        const a = new Uint8Array(new ArrayBuffer(r),0,r);
        for (const {id: t, s: r, e: i, l: s} of o) {
            const o = await fetch("/r/" + t, {
                cache: "force-cache",
                method: "GET",
                headers: {
                    Range: "bytes=" + r + "-" + (i - 1)
                }
            });
            if (!o.ok)
                throw Error("Failed to fetch resources: Remote returned error status code: " + o.status);
            206 === o.status && o.headers.has("content-range") ? a.set(new Uint8Array(await o.arrayBuffer(),0,s), n) : a.set(new Uint8Array(await o.arrayBuffer(),r,s), n),
                n += s
        }
        console.log(a.buffer)
        return a.buffer
    }

    async function loadSwf(data) {
        await loadJS("/lib/ruffle/ruffle.js");
        const player = win.RufflePlayer;
        if (player == null)
            throw new Error("Failed to load Ruffle player.");

        const frame = player.newest().createPlayer();
        frame.style.width = "100%";
        frame.style.height = "100%";
        body.innerHTML = "";
        body.appendChild(frame);

        await frame.load({
            data: data,
            wmode: "opaque",
            scale: "showAll",
            quality: "best",
            autoplay: "auto",
            logLevel: "warn",
            letterbox: "on",
            openUrlMode: "confirm",
            upgradeToHttps: true
        });
    }

    /**
     * @param {string} url
     */
    function loadJS(url) {
        return new Promise((resolve, reject) => {
            const elem = doc.createElement("script");
            elem.type = "text/javascript";
            elem.src = url;
            elem.async = true;
            elem.defer = true;

            elem.onload = () => {
                resolve(null);
                elem.onload = null;
                elem.onerror = null;
            };
            elem.onerror = (e) => {
                reject(e);
                elem.onload = null;
                elem.onerror = null;
            };

            body.appendChild(elem);
        });
    }

    /**
     * @param {Uint8Array} data
     */
    async function loadDos(data) {
        await loadJS("/lib/jsdos/js-dos.js");
        const Dos = win.Dos;
        if (Dos == null)
            throw new Error("Failed to load player API.");

        const frame = doc.createElement("div");
        body.innerHTML = "";
        body.appendChild(frame);

        const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream", endings: "native" }));

        Dos(frame, {
            onEvent: (e) => {
                if (e === "emu-ready")
                    URL.revokeObjectURL(url);
            },
            url: url,
            theme: "light",
            backend: "dosboxX",
            noCloud: true,
            noCursor: true,
            autoStart: true,
            pathPrefix: "/lib/jsdos/emulators/",
            workerThread: true,
            mouseCapture: true,
            renderAspect: "4/3",
            renderBackend: "webgl"
        });
    }

    console.log("called")
    let path = gamecontent.replace("!content!", "")
    let data = await u(path)
    switch (gametype) {
        case "flash":
            console.log("flash");
            await loadSwf(data);
            break;
        case "dos":
            console.log("DOS")
            await loadDos(data);
            break;
        default:
            console.error("Unknown player type: ", gametype);
            break;
    }

})(window);
