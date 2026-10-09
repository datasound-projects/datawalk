"""Run a notebook with nbclient: python -m datawalk.importers.execute IN OUT TIMEOUT.
The importer starts this in a separate process, only when the author asks (--execute)."""

import sys
from pathlib import Path


def main() -> None:
    try:
        import nbformat
        from nbclient import NotebookClient
    except ImportError:
        sys.exit("Notebook execution needs nbclient: pip install 'datawalk[notebook]'")
    src, out, timeout = sys.argv[1], sys.argv[2], int(sys.argv[3])
    nb = nbformat.read(src, as_version=4)
    NotebookClient(
        nb,
        timeout=timeout,
        kernel_name=nb.metadata.get("kernelspec", {}).get("name", "python3"),
        # Like Jupyter: the notebook runs in its own folder (relative data paths work).
        resources={"metadata": {"path": str(Path(src).resolve().parent)}},
    ).execute()
    nbformat.write(nb, out)


if __name__ == "__main__":
    main()
