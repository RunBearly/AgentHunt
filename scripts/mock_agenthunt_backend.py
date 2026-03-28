#!/usr/bin/env python3
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    registry = {
        "services": {},
        "reviews": [],
        "invocations": [],
    }

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(body)
        method = payload.get("method")
        params = payload.get("params", {})
        result = self.dispatch_method(method, params)
        response = json.dumps({"jsonrpc": "2.0", "id": payload.get("id"), "result": result}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    @classmethod
    def dispatch_method(cls, method: str, params: dict) -> dict:
        if method == "search_services":
            query = params.get("query", "").lower()
            category_id = params.get("category_id")
            matches = [
                value
                for value in cls.registry["services"].values()
                if query in value["service_name"].lower() and value["category_id"] == category_id
            ]
            return matches
        if method == "get_service_details":
            service_id = params["service_id"]
            return cls.registry["services"].get(service_id, {"service_id": service_id})
        if method == "get_service_trust_signals":
            service_id = params["service_id"]
            return {
                "service_id": service_id,
                "review_count": sum(1 for r in cls.registry["reviews"] if r["service_id"] == service_id),
                "verified_invocation_count": sum(
                    1 for r in cls.registry["invocations"] if r["service_id"] == service_id
                ),
            }
        if method == "submit_service":
            service_id = params["service_id"]
            cls.registry["services"][service_id] = params
            return {"service_id": service_id, "created": True}
        if method == "submit_review":
            cls.registry["reviews"].append(params)
            return {"accepted": True, "service_id": params["service_id"]}
        if method == "record_verified_invocation":
            cls.registry["invocations"].append(params)
            return {"accepted": True, "service_id": params["service_id"]}
        return {"error": f"unknown method: {method}"}


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8765), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
