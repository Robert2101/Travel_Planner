import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "travel_planner")

client = AsyncIOMotorClient(MONGODB_URI)
db = client[DATABASE_NAME]

async def get_database():
    return db
