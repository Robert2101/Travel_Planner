import math

# City center of Vijayawada (for start-point scoring)
CITY_CENTER = {"lat": 16.5062, "lng": 80.6480}

def calculate_optimal_days(places, max_hours_per_day=8):
    """O(1). Total visit hours ÷ usable hours per day."""
    total = sum(p.get("avg_time_hours", 2) for p in places)
    return math.ceil(total / max_hours_per_day)


def filter_places(all_places, interests=None):
    """
    Returns all places sorted so interest-matched ones come first.
    Falls back to full list if no interest matches at all.
    BUG FIX: was exact-match only with no ranking — now ranked.
    """
    if not interests:
        return list(all_places)

    matched   = [p for p in all_places if p.get('type') in interests]
    unmatched = [p for p in all_places if p.get('type') not in interests]

    # Always return matched first; include unmatched so there's content even
    # when interests are narrow. Caller can trim via max_days if needed.
    return matched + unmatched if matched else list(all_places)
