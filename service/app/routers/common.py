from ..store import store

def check_founder(founder_id: str | None = None):
    store.check_founder(founder_id)
