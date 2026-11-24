from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / '.env')  # repo-root .env (gitignored)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import activity, briefing, buyers, categories, competitors, connectors, contacts, credits, graph, graphstream, icp, integrations, interview, knowledge, outreach, paths, pipeline, prospect, search, valuemap
from .store import store

@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    yield

app = FastAPI(title='DeepBridge', version='0.1.0', lifespan=lifespan,
              description='Cached research demo. Publication affiliations are dated; messages are drafts only.')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
                   allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
for module in [icp, buyers, graph, paths, outreach, pipeline, credits, search, contacts, competitors, activity, interview, prospect, valuemap, categories, knowledge, briefing, graphstream, connectors, integrations]:
    app.include_router(module.router)
app.include_router(__import__(__package__ + '.routers.prospect', fromlist=['router']).router)
app.include_router(__import__(__package__ + '.routers.connectors', fromlist=['router']).router)

@app.get('/health')
def health():
    hopo = getattr(store, 'jakob_active_founder_id', None) == 'person:openalex:A5043992375'
    return {'status': 'ok', 'data': 'cache',
            'case': 'HOPO Therapeutics / Rebecca Abergel' if hopo else 'Lightmatter / Nicholas C. Harris'}
