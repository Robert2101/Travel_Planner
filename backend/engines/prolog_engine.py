import os
import subprocess
import tempfile
import logging

log = logging.getLogger(__name__)

# Fallback paths for different macOS/Linux setups
SWIPL_PATHS = [
    "swipl", 
    "/opt/homebrew/bin/swipl", 
    "/usr/local/bin/swipl", 
    "/Applications/SWI-Prolog.app/Contents/MacOS/swipl"
]

def find_swipl():
    """Finds the path to the SWI-Prolog binary."""
    for path in SWIPL_PATHS:
        try:
            subprocess.run([path, "--version"], capture_output=True, check=True)
            return path
        except (FileNotFoundError, NotADirectoryError, subprocess.SubprocessError):
            continue
    return None

def filter_places_with_prolog(all_places, interests=None):
    """
    Uses SWI-Prolog to filter travel places by user interests.
    This replaces the Python logic with a logic programming paradigm.
    """
    if not interests:
        return list(all_places)

    swipl_bin = find_swipl()
    if not swipl_bin:
        log.warning("SWI-Prolog not found! Falling back to standard Python matching.")
        return _filter_places_python(all_places, interests)

    rules_path = os.path.join(os.path.dirname(__file__), "rules.pl")
    
    # We dynamically create a temporary .pl file containing all facts (the DB)
    with tempfile.NamedTemporaryFile(mode='w', suffix='.pl', delete=False) as temp_pl:
        # Import the main rules
        temp_pl.write(f":- consult('{rules_path}').\n\n")
        
        # Write facts for the user's interests
        # We sanitize strings to ensure Prolog parses them safely
        for interest in interests:
            safename = interest.replace("'", "\\'")
            temp_pl.write(f"interest('{safename}').\n")
            
        # Write facts for every place in the database
        for place in all_places:
            safetype = (place.get('type') or 'unknown').replace("'", "\\'")
            place_id = place['id'].replace("'", "\\'")
            temp_pl.write(f"place('{place_id}', '{safetype}').\n")
        
        temp_file_path = temp_pl.name

    try:
        # Run Prolog query to find all places that satisfy recommended_place(X)
        # Fix: using -g for initialization goal and -t halt for toplevel to exit quietly
        query = "findall(X, recommended_place(X), L), write(L)"
        
        # Execute SWI-Prolog quietly (-q) and use the temporary file as the state
        result = subprocess.run([swipl_bin, "-q", "-f", temp_file_path, "-g", query, "-t", "halt"], 
                              capture_output=True, text=True, check=True)
        
        output = result.stdout.strip()
        
        # Parse the Prolog List output: e.g. '[p1,p5,p13]'
        if output.startswith("[") and output.endswith("]"):
            # Clean up the output string to extract raw IDs
            inner = output[1:-1]
            if not inner.strip():
                recommended_ids = []
            else:
                recommended_ids = [id.strip() for id in inner.split(",")]
            
            # Organize places: Matched places first, then everything else
            matched_places = [p for p in all_places if p['id'] in recommended_ids]
            unmatched_places = [p for p in all_places if p['id'] not in recommended_ids]
            
            # Ensure we return both, just sorted by relevance to interests
            return matched_places + unmatched_places if matched_places else list(all_places)
        else:
            log.error(f"Unexpected output from Prolog Engine: {output}")
            return _filter_places_python(all_places, interests)
            
    except subprocess.CalledProcessError as e:
        log.error(f"Prolog execution failed: {e.stderr}")
        return _filter_places_python(all_places, interests)
    finally:
        # Always remove the temporary database file
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

def _filter_places_python(all_places, interests=None):
    """The old python filtering logic kept as a robust fallback."""
    if not interests:
        return list(all_places)

    matched   = [p for p in all_places if p.get('type') in interests]
    unmatched = [p for p in all_places if p.get('type') not in interests]
    return matched + unmatched if matched else list(all_places)
