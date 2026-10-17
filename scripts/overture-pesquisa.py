# Pesquisa (17/10/2026): consulta dados ABERTOS do Overture Maps (lugares) por bbox, sem chave de API.
# Uso: python -m venv v; v/Scripts/pip install duckdb; v/Scripts/python scripts/overture-pesquisa.py
# Resultado em Bauru (raio 3 km): 10.939 POIs, 89% com telefone, 46% com site; 102 padarias, 22 açougues (OSM tinha 11 e 1).
import duckdb, time, collections
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("SET s3_region='us-west-2';")
REL = "2026-09-23.1"
SRC = f"s3://overturemaps-us-west-2/release/{REL}/theme=places/type=place/*"
lat, lng, km = -22.3246, -49.0871, 3
dlat = km / 111.0
dlng = km / (111.0 * 0.925)
w, e, s, n = lng - dlng, lng + dlng, lat - dlat, lat + dlat

t0 = time.time()
q = f"""
SELECT names.primary, taxonomy.primary, basic_category, phones[1], websites[1],
       addresses[1].freeform, round(confidence, 2), operating_status, bbox.ymin, bbox.xmin
FROM read_parquet('{SRC}', hive_partitioning=1)
WHERE bbox.xmin BETWEEN {w} AND {e} AND bbox.ymin BETWEEN {s} AND {n}
"""
rows = con.execute(q).fetchall()
print(f"[{time.time()-t0:.0f}s] total POIs no raio de {km} km: {len(rows)}")
print("com telefone:", sum(1 for r in rows if r[3]), "| com site:", sum(1 for r in rows if r[4]), "| com endereco:", sum(1 for r in rows if r[5]))
print("\nTop categorias:")
for c, k in collections.Counter(r[1] for r in rows).most_common(12):
    print(f"  {k:4d}  {c}")
for termo in ["bakery", "butcher", "meat", "restaurant", "supermarket", "grocery"]:
    sub = [r for r in rows if termo in str(r[1]).lower() or termo in str(r[2]).lower()]
    sub.sort(key=lambda r: -(r[6] or 0))
    print(f"\n== '{termo}': {len(sub)} resultados")
    for r in sub[:8]:
        print(f"  {str(r[0])[:34]:34s} | tel={str(r[3])[:16]:16s} | conf={r[6]} | {str(r[5])[:40]}")
