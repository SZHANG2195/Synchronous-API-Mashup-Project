const fs = require("fs");
const http = require("http");
const https = require("https");

const credentials = require("./auth/credentials.json");
const port = process.env.PORT || 3000;

const twitch_client_id = credentials.igdb["Client-ID"] || "";
const twitch_client_secret = credentials.igdb["client_secret"] || "";
const twitch_access_token = credentials.igdb["Authorization"] || "";

const discogs_user_agent = credentials.discogs["User-Agent"] || "";
const discogs_token = credentials.discogs["Authorization"] || "";

const igdb_request_headers = {
    "Client-ID": twitch_client_id,
    "Authorization": twitch_access_token,
    "Content-Type": "text/plain"
};

const discogs_request_headers = {
    "User-Agent": discogs_user_agent,
    "Authorization": discogs_token
};

const response_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Transfer-Encoding": "chunked" 
};

const igdb_token_body_obj = {
    client_id: twitch_client_id,
    client_secret: twitch_client_secret,
    grant_type: "client_credentials"
};

const igdb_token_body = new URLSearchParams(igdb_token_body_obj).toString();

const igdb_token_headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(igdb_token_body)
};

const server = http.createServer();
server.on("request", handle_request);
server.on("listening", handle_listen);
server.listen(port);

function handle_listen(){
    console.log(`Now Listening on Port ${port}`);
}

function handle_request(req, res){
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("html/index.html");
        res.writeHead(200, response_headers)
        form.pipe(res);
    }
    else if (req.url.startsWith("/search")){
        try {
            url_object = new URL(req.url, `http://${req.headers.host}`);
        } catch (e) {
            console.error("Malformed URL received:", req.url);
            res.writeHead(400, response_headers);
            return res.end("<h1>400 Bad Request: Invalid URL</h1>");
        }
        const user_input = url_object.searchParams;
        res.writeHead(200, response_headers);
        const shellStream = fs.createReadStream("html/shell.html.part");
        shellStream.on('open', () => {
            shellStream.pipe(res, { end: false });
        });
        shellStream.on('end', () => {
            const genres = user_input.getAll("genre");
            const platforms = user_input.getAll("platform");
            const modes = user_input.getAll("mode");
            const min_rating = user_input.get("rating") || "0";
            const max_rating = user_input.get("rating_max") || "100";
            get_igdb_data(genres, platforms, modes, min_rating, max_rating, res);
        });
    }
    else if (req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }
    else{
        res.writeHead(404, response_headers);
        return res.end(`<h1>404 Not Found</h1>`);
    }
}

function process_http_stream(stream, callback, ...args) {
    const {statusCode: status_code} = stream;
    let body = "";
    stream.on("data", function (chunk) {
        body += chunk;
    });
    stream.on("end", () => callback(body, status_code, ...args));
}

function get_igdb_token(callback) {
    const token_req = https.request("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: igdb_token_headers
    });
    token_req.once("response", (token_res) => {
        process_http_stream(token_res, (body) => {
            const data = JSON.parse(body);
            igdb_request_headers["Authorization"] = `Bearer ${data.access_token}`;
            credentials.igdb["Authorization"] = `Bearer ${data.access_token}`;
            fs.writeFileSync("./auth/credentials.json", JSON.stringify(credentials, null, 4));
            callback();
        });
    });
    token_req.write(igdb_token_body);
    token_req.end();
}

function get_igdb_data(genres, platforms, modes, min_rating, max_rating, res) {
    const conditions = [];
    if (genres.length > 0) {
        conditions.push(`genres != null & ${genres.map(g => `genres.name = "${g}"`).join(" & ")}`);
    }
    if (platforms.length > 0) {
        conditions.push(`platforms != null & platforms = (${platforms.join(",")})`);
    }
    if (modes.length > 0) {
        conditions.push(`game_modes != null & game_modes = (${modes.join(",")})`);
    }
    if (min_rating || max_rating) {
        conditions.push(`rating >= ${min_rating || 0} & rating <= ${max_rating || 100}`);
    }

    if (conditions.length === 0) {
        res.write("<p>Please select at least one filter.</p>");
        res.write("</body></html>");
        return res.end();
    }

    const where_clause = `where ${conditions.join(" & ")};`;

    const query = `fields name,rating,summary,cover.url,genres.name;\n${where_clause}\nsort rating desc;\nlimit 1;`;

    console.log("Query sent as: \n" + query + "\n");
	
	if (!fs.existsSync("./cache")) {
    fs.mkdirSync("./cache");
	}

    const igdb_cache_path = "./cache/igdb_cache.json";
    if (fs.existsSync(igdb_cache_path)) {
        try {
            const cacheData = fs.readFileSync(igdb_cache_path, "utf8");
            if (cacheData.trim()) {
                const cache = JSON.parse(cacheData);

                if (cache[query]) {
                    const cacheEntry = cache[query];
                    const ONE_DAY = 24 * 60 * 60 * 1000;
                    const cacheAge = Date.now() - cacheEntry.timestamp;

                    if (cacheAge < ONE_DAY) {
                        console.log(`IGDB cache hit for filters, reusing game match for this filter combination.`);
                        return parse_igdb(JSON.stringify(cacheEntry.games), 200, genres, platforms, modes, min_rating, max_rating, res, query);
                    } else {
                        console.log(`IGDB cache expired for this query. Re-fetching fresh game...`);
                    }
                }
            }
        } catch (e) {
            console.error("IGDB Cache read error:", e.message);
        }
    }

    const igdb_req = https.request("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: igdb_request_headers
    });
    
    igdb_req.once("response", (igdb_res) => {
        process_http_stream(igdb_res, parse_igdb, genres, platforms, modes, min_rating, max_rating, res, query);
    });
    
    igdb_req.write(query);
    //igdb_req.end();
    setTimeout( () => igdb_req.end() , 5000);
}

function parse_igdb(body, status_code, genres, platforms, modes, min_rating, max_rating, res, queryKey) {
    if (status_code === 401) {
        return get_igdb_token(() => get_igdb_data(genres, platforms, modes, min_rating, max_rating, res));
    }

    console.log("IGDB Response returned as: \n", body);
    
    let games;
    try {
        games = JSON.parse(body);
    } catch (e) {
        res.write("<p>Error parsing game data.</p>");
        return res.end();
    }

    if (!games || games.length === 0) {
        res.write("<p>No games found for the selected filters.</p>");
        res.write("</body></html>");
        return res.end();
    }

     const igdb_cache_path = "./cache/igdb_cache.json";
    let cache = {};
        
    if (fs.existsSync(igdb_cache_path)) {
        try {
            const cacheData = fs.readFileSync(igdb_cache_path, "utf8");
            if (cacheData.trim()) cache = JSON.parse(cacheData);
        } catch (err) {}
    }

    cache[queryKey] = {
        timestamp: Date.now(),
        games: games
    };

    try {
        fs.writeFileSync(igdb_cache_path, JSON.stringify(cache, null, 2), "utf8");
        console.log(`Successfully cached IGDB result under filter query key.`);
    } catch (err) {
        console.error("IGDB Cache write error:", err.message);
    }
    
    const top_game = games[0];
    const name = top_game.name;
    console.log("Game Name:", name);
    const rating = Math.round(top_game.rating) || "N/A";
    const summary = top_game.summary || "No summary available.";
    const cover_url = top_game.cover ? `https:${top_game.cover.url}` : null;
    const cover_html = cover_url ? `<img src="${cover_url}" alt="${name} cover">` : "";
    
    res.write(`
        <div>
            <h2>${name}</h2>
            ${cover_html}
            <p>Rating: ${rating}</p>
            <p>${summary}</p>
        </div>
    `);
    
    get_discogs_data(name, res);
}

function get_discogs_data(name, res) {
    const discogs_cache_path = "./cache/discogs_cache.json";
    if (!name) {
        console.error("Error fetching Discogs data because game name is missing.");
        return res.send("Invalid game search.");
    }
    const cacheKey = name.trim().toLowerCase();

    if (fs.existsSync(discogs_cache_path)) {
        try {
            const cacheData = fs.readFileSync(discogs_cache_path, "utf8");
            if (cacheData.trim()) {
                const cache = JSON.parse(cacheData);
                
                if (cache[cacheKey]) {
                    const cacheEntry = cache[cacheKey];
                    if (cacheEntry && cacheEntry.timestamp) {
                        const ONE_DAY = 24 * 60 * 60 * 1000;
                        const cacheAge = Date.now() - cacheEntry.timestamp;

                        if (cacheAge < ONE_DAY) {
                            console.log(`Discogs cache hit for query: "${cacheKey}" (${Math.round(cacheAge/1000/60)} mins old)`);
                            return display_discogs(cacheEntry.results, name, res);
                        } else {
                            console.log(`Cache expired for query: "${cacheKey}". Re-querying live Discogs API...`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Cache read error:", e.message);
        }
    }
    
    console.log(`Discogs API called for game: ${name}`);
    const query = encodeURIComponent(name + " soundtrack");
    const discogs_req = https.request({
        hostname: "api.discogs.com",
        path: `/database/search?q=${query}&type=release&per_page=5&page=1`,
        method: "GET",
        headers: discogs_request_headers
    });
    
    discogs_req.once("response", (discogs_res) => {
        process_http_stream(discogs_res, parse_discogs, name, res, cacheKey);
    });
    discogs_req.end();
}

function parse_discogs(body, status_code, name, res, cacheKey) {
    console.log(`Discogs Response Status: ${status_code}`);
    if (status_code !== 200) {
        res.write(`<p>Error fetching soundtrack data.</p>`);
        return res.end();
    }

    let data;
    try {
        data = JSON.parse(body);
    } catch (e) {
        return res.end();
    }

    const results = data.results || [];
    const discogs_cache_path = "./cache/discogs_cache.json";
    let cache = {};
    
    if (fs.existsSync(discogs_cache_path)) {
        try {
            const cacheData = fs.readFileSync(discogs_cache_path, "utf8");
            if (cacheData.trim()) cache = JSON.parse(cacheData);
        } catch (err) {}
    }
    cache[cacheKey] = {
        timestamp: Date.now(),
        results: results
    };

    try {
        fs.writeFileSync(discogs_cache_path, JSON.stringify(cache, null, 2), "utf8");
        console.log(`Successfully cached fresh results for key: "${cacheKey}"`);
    } catch (err) {
        console.error("Cache write error:", err.message);
    }

    return display_discogs(results, name, res);
}

function format_discogs_result(result) {
    const title = result.title || "Unknown Title";
    const year = result.year || "N/A";
    const format = result.format?.join(", ") || "N/A";
    const label = result.label?.[0] || "Unknown Label";
    const url = `https://www.discogs.com${result.uri}`;
    const want = result.community?.want || 0;
    const have = result.community?.have || 0;
    return `
        <li>
            <a href="${url}">${title}</a>
            <p>${format} — ${label} (${year})</p>
            <p>Want: ${want} / Have: ${have}</p>
        </li>
    `;
}

function display_discogs(results, name, res) {
    if (results.length === 0) {
        res.write(`<p>No soundtrack results found for ${name}.</p>`);
    } else {
        const items = results.map(format_discogs_result).join("");
        res.write(`<div><h2>Soundtracks for ${name}</h2><ul>${items}</ul></div>`);
    }
    res.write("</body></html>");
    res.end();
}