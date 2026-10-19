"""Non-unique indexes matching user polling and worker queue queries."""
import logging


def ensure_scrape_indexes(db):
    indexes = [
        ('scrape_jobs', [('created_by_username', 1), ('surface', 1), ('dismissed_at', 1),
                         ('status', 1), ('created_at', -1)]),
        ('scrape_jobs', [('created_by_username', 1), ('surface', 1), ('dismissed_at', 1),
                         ('finished_at', -1)]),
        ('scrape_jobs', [('status', 1), ('last_progress_at', 1)]),
        ('send_queue_items', [('user_id', 1), ('status', 1), ('created_at', 1),
                              ('queue_order', 1), ('_id', 1)]),
        ('send_queue_items', [('status', 1), ('user_id', 1)]),
        ('users', [('session_token', 1), ('active', 1)]),
    ]
    for collection, keys in indexes:
        try:
            db[collection].create_index(keys)
        except Exception:
            logging.getLogger(__name__).exception('Could not ensure index on %s: %s', collection, keys)
