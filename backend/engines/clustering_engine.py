import math

# ── Configurable weights (empirically tuned) ──────────────────────────────────
# w_dist  : penalise far places         → keeps daily routes tight
# w_time  : penalise waiting at closed  → avoids dead time
# w_int   : reward user-interest match  → respects preference
# Complexity: O(n²) per day — acceptable for ≤50 places
WEIGHTS = {"distance": 1.0, "time_fit": 0.5, "interest": 0.5}


# ── Geometry helpers ──────────────────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2       = math.radians(lat1), math.radians(lat2)
    dphi             = math.radians(lat2 - lat1)
    dlambda          = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def time_to_float(t: str) -> float:
    h, m = map(int, t.split(':'))
    return h + m / 60.0

def float_to_time(t: float) -> str:
    h = int(t)
    m = round((t - h) * 60)        # BUG FIX: round, not int
    if m == 60:                     # edge case: 9:60 → 10:00
        h += 1; m = 0
    return f"{h:02d}:{m:02d}"

# ── Pre-compute max pairwise distance (for normalisation) ─────────────────────
def get_max_distance(places):
    max_d = 1.0   # BUG FIX: clamp ≥ 1 so norm never blows up with close clusters
    for i in range(len(places)):
        for j in range(i+1, len(places)):
            d = haversine(places[i]['lat'], places[i]['lng'],
                          places[j]['lat'], places[j]['lng'])
            if d > max_d:
                max_d = d
    return max_d

# ── Dynamic urban speed (km/h) ────────────────────────────────────────────────
def get_dynamic_speed(t: float) -> float:
    if (8.5 <= t <= 10.5) or (17.5 <= t <= 20.0):
        return 15.0   # peak hours
    return 25.0       # off-peak

# ── Arrival calculator with chaos buffer ──────────────────────────────────────
def calculate_arrival(current_time, clat, clng, target):
    dist       = haversine(clat, clng, target['lat'], target['lng'])
    speed      = get_dynamic_speed(current_time)
    travel_hrs = dist / speed
    buffer     = max(travel_hrs * 0.10, 10/60)   # max(10 %, 10 min)
    return current_time + travel_hrs + buffer, dist


# ── Main clustering function ──────────────────────────────────────────────────
def cluster_places_by_day(places, days_required, user_interests=None):
    if not places:
        return []

    user_interests = user_interests or []
    max_dist       = get_max_distance(places)
    unvisited      = list(places)   # already deep-copied in app.py
    days           = []

    DAY_START      = 9.0
    DAY_END        = 21.0
    TOTAL_DAY_HRS  = DAY_END - DAY_START

    for day_idx in range(days_required):
        if not unvisited:
            break

        current_time       = DAY_START
        current_day_places = []

        # ── BUG FIX: Smart start — earliest-opening place (not random index 0) ──
        first = min(unvisited, key=lambda p: time_to_float(p['opening_time']))
        unvisited.remove(first)

        p_open = time_to_float(first['opening_time'])
        if current_time < p_open:
            current_time = p_open              # wait for doors to open

        first['visit_start'] = float_to_time(current_time)
        current_time        += first.get('avg_time_hours', 2)
        first['visit_end']   = float_to_time(current_time)
        current_day_places.append(first)
        current_place = first

        # ── First pass: O(n²) weighted heuristic ─────────────────────────────
        while unvisited:
            best_score, best_idx, best_arrival = float('inf'), -1, None

            for i, p in enumerate(unvisited):
                target_open  = time_to_float(p['opening_time'])
                target_close = time_to_float(p['closing_time'])

                arrival, dist = calculate_arrival(
                    current_time, current_place['lat'], current_place['lng'], p
                )

                wait_time = 0.0
                if arrival < target_open:
                    wait_time = target_open - arrival
                    arrival   = target_open

                finish = arrival + p.get('avg_time_hours', 2)
                if finish > target_close or finish > DAY_END:
                    continue   # doesn't fit — skip

                norm_dist      = dist / max_dist           # BUG FIX: max_dist ≥ 1
                time_penalty   = wait_time / TOTAL_DAY_HRS
                interest_bonus = 1.0 if p.get('type') in user_interests else 0.0

                score = (WEIGHTS["distance"] * norm_dist
                       + WEIGHTS["time_fit"] * time_penalty
                       - WEIGHTS["interest"] * interest_bonus)

                if score < best_score:
                    best_score, best_idx, best_arrival = score, i, arrival

            if best_idx != -1:
                chosen                 = unvisited.pop(best_idx)
                chosen['visit_start']  = float_to_time(best_arrival)
                current_time           = best_arrival + chosen.get('avg_time_hours', 2)
                chosen['visit_end']    = float_to_time(current_time)
                current_day_places.append(chosen)
                current_place = chosen
            else:
                break   # nothing valid left for today

        # ── Second pass: stuff short skipped places into remaining time ───────
        if unvisited and (DAY_END - current_time) >= 1.0:
            for i in range(len(unvisited) - 1, -1, -1):
                p            = unvisited[i]
                t_open       = time_to_float(p['opening_time'])
                t_close      = time_to_float(p['closing_time'])
                arrival, _   = calculate_arrival(current_time,
                                                  current_place['lat'], current_place['lng'], p)
                if arrival < t_open:
                    arrival = t_open
                finish = arrival + p.get('avg_time_hours', 2)
                if finish <= t_close and finish <= DAY_END:
                    chosen               = unvisited.pop(i)
                    chosen['visit_start']= float_to_time(arrival)
                    current_time         = finish
                    chosen['visit_end']  = float_to_time(current_time)
                    current_day_places.append(chosen)
                    current_place = chosen

        days.append({
            "day":         day_idx + 1,
            "places":      current_day_places,
            "total_hours": round(current_time - DAY_START, 1),
        })

    return days
