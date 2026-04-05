from engines.clustering_engine import haversine, get_dynamic_speed, time_to_float

def estimate_transport_cost(distance_km, speed_kmh):
    if distance_km == 0:
        return {"auto": 0, "cab": 0, "bike": 0, "mins": 0}
        
    base_fare_auto = 30
    base_fare_cab = 50
    base_fare_bike = 20
    
    auto_rate = 12
    cab_rate = 15
    bike_rate = 8
    
    # Calculate travel time in mins + 10% or 10 min chaos buffer
    raw_hrs = distance_km / speed_kmh
    buffer = max(raw_hrs * 0.10, 0.166)
    est_mins = round((raw_hrs + buffer) * 60)
    
    return {
        "auto": round(base_fare_auto + (distance_km * auto_rate)),
        "cab": round(base_fare_cab + (distance_km * cab_rate)),
        "bike": round(base_fare_bike + (distance_km * bike_rate)),
        "mins": est_mins
    }

def calculate_day_routes(day_plan):
    places = day_plan['places']
    routes = []
    
    for i in range(len(places) - 1):
        p1 = places[i]
        p2 = places[i+1]
        
        dist = haversine(p1['lat'], p1['lng'], p2['lat'], p2['lng'])
        p1_end_time = time_to_float(p1['visit_end'])
        
        speed = get_dynamic_speed(p1_end_time)
        costs = estimate_transport_cost(dist, speed)
        
        routes.append({
            "from": p1['name'],
            "to": p2['name'],
            "distance_km": round(dist, 1),
            "costs": costs
        })
        
    day_plan['routes'] = routes
    return day_plan
