import "dreamland";
import { Route, Router } from "dreamland-router";
import Home from "./routes/home";
import Error from "./routes/error";
import "./index.css";
import Privacy from "./routes/privacy.jsx";
import Terms from "./routes/terms.jsx";

new Router(
    (
        <Route>
            <Route path="/proxe" show={<Home />} />
            <Route path="/privacy" show={<Privacy />} />
            <Route path="/terms" show={<Terms />} />
            <Route path="*" show={<Error />} />
        </Route>
    ),
).mount(document.getElementById("app"));
