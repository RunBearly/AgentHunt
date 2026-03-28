from pathlib import Path


def repo_root(start: Path | None = None) -> Path:
    current = (start or Path(__file__)).resolve()
    if current.is_file():
        current = current.parent
    for candidate in [current, *current.parents]:
        if (candidate / "config" / "runtime.json").exists():
            return candidate
    raise FileNotFoundError("Could not locate repo root")


def catalogs_dir() -> Path:
    return repo_root() / "catalogs"


def config_dir() -> Path:
    return repo_root() / "config"


def results_dir() -> Path:
    return repo_root() / "results" / "runs"
