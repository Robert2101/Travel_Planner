% rules.pl
% This is a simple rule-based engine to filter travel destinations based on user interests.

% Rule to determine if a place is recommended based on interests.
% A place is recommended if its Type matches an interest explicitly defined by the user.
recommended_place(PlaceID) :-
    place(PlaceID, Type),
    interest(Type).
