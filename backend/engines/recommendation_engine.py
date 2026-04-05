from engines.clustering_engine import haversine

HOTEL_RADIUS_KM = 3.0
FOOD_RADIUS_KM  = 2.5


def get_recommendations(day_plan, hotels_db, food_db):
    """
    Pure Haversine proximity matching for both hotels AND food.
    Hotels: within HOTEL_RADIUS_KM of any place in the day.
    Food:   within FOOD_RADIUS_KM  of any place in the day.
    Falls back to nearest 2/3 from the full DB if nothing is close enough.
    """
    day_places          = day_plan['places']
    recommended_hotels  = []
    recommended_food    = []

    # ── Hotels ────────────────────────────────────────────────────────────────
    for hotel in hotels_db:
        if hotel.get('lat') is None:
            continue
        for place in day_places:
            d = haversine(place['lat'], place['lng'], hotel['lat'], hotel['lng'])
            if d <= HOTEL_RADIUS_KM:
                if hotel not in recommended_hotels:
                    recommended_hotels.append(hotel)
                break   # no need to check other places once matched

    # ── Food (now also Haversine — no more string fragility) ──────────────────
    for food in food_db:
        if food.get('lat') is None:
            continue
        for place in day_places:
            d = haversine(place['lat'], place['lng'], food['lat'], food['lng'])
            if d <= FOOD_RADIUS_KM:
                if food not in recommended_food:
                    recommended_food.append(food)
                break

    # ── Fallbacks ─────────────────────────────────────────────────────────────
    if not recommended_hotels:
        recommended_hotels = hotels_db[:2]
    if not recommended_food:
        recommended_food   = food_db[:3]

    day_plan['recommendations'] = {
        "hotels": recommended_hotels[:2],
        "food":   recommended_food[:3],
    }
    return day_plan
