import axios from 'axios';

async function searchURL(
    input,
    searchEngine = "https://www.google.com/search?q=%s",
) {
    plausible("Search", {props: {"Query": input}});
    if (input.includes('porn') || input.includes('hentai') || input.includes('xhamster') || input.includes('xvideos') || input.includes('xxxvideos') || input.includes('xnxx') || input.includes('rule34')) {
        return (window.location.origin + window.__uv$config.prefix + window.__uv$config.encodeUrl("https://everyonegetsnews.org/nsfw/"));
    }
    if (input.includes('roblox')) {
        alert('go to nowgg.lol for unblocked roblox')
    }
    if (input.match(/^https?:\/\//)) {
        return (window.location.origin + window.__uv$config.prefix + window.__uv$config.encodeUrl(input));
    } else if (input.includes(".") && !input.includes(" ")) {
        return (window.location.origin + window.__uv$config.prefix + window.__uv$config.encodeUrl("https://" + input));
    } else {
        return (window.location.origin + window.__uv$config.prefix + window.__uv$config.encodeUrl( searchEngine.replace("%s", encodeURIComponent(input))));
    }
}

export { searchURL };
