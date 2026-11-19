"""Synthetic DE/EN knowledge only. Calls a dedicated verified model endpoint.
Model latency is recorded separately from the storage-only Rust benchmark.
"""
import argparse, hashlib, json, time, urllib.request, uuid
from pathlib import Path

topics = [
 ('solar','Solar panels convert sunlight into electricity. A battery stores surplus electricity.','Solarmodule wandeln Sonnenlicht in Strom um. Ein Akku speichert den Überschuss.','How do solar panels generate electricity?','Wie erzeugen Solarmodule Strom?'),
 ('backup','A backup preserves canonical Markdown and attachments separately from derived indexes.','Eine Sicherung bewahrt Markdown und Anhänge getrennt vom abgeleiteten Suchindex auf.','What should a portable knowledge backup preserve?','Was gehört in eine portable Wissenssicherung?'),
 ('water','Rainwater is collected in a covered tank. Filters remove leaves before storage.','Regenwasser wird in einem abgedeckten Tank gesammelt. Filter entfernen Blätter vor der Speicherung.','How is rainwater collected and filtered?','Wie wird Regenwasser gesammelt und gefiltert?'),
 ('bread','Bread dough needs flour, water, salt and yeast. Fermentation produces gas that raises the dough.','Brotteig enthält Mehl, Wasser, Salz und Hefe. Die Gärung erzeugt Gas und lässt den Teig aufgehen.','Why does bread dough rise?','Warum geht Brotteig auf?'),
 ('rail','The synthetic regional train departs platform four at 09:30. Reservations are optional.','Der fiktive Regionalzug fährt um 09:30 von Gleis vier ab. Reservierungen sind freiwillig.','Which platform does the regional train use?','Von welchem Gleis fährt der Regionalzug ab?'),
 ('garden','Tomato plants prefer sunlight and evenly moist soil. Water the roots rather than the leaves.','Tomaten bevorzugen Sonne und gleichmäßig feuchten Boden. Das Wasser wird an die Wurzeln gegeben.','How should tomato plants be watered?','Wie sollten Tomaten gegossen werden?'),
 ('rust','Rust ownership permits one owner of a value. Borrowing lets code access values through references.','Rust erlaubt einen Besitzer pro Wert. Ausleihen ermöglicht den Zugriff über Referenzen.','What does borrowing mean in Rust?','Was bedeutet Ausleihen in Rust?'),
 ('sync','LiveSync splits files into chunks and replicates revisions through CouchDB. Conflicts need review.','LiveSync zerlegt Dateien in Stücke und repliziert Revisionen über CouchDB. Konflikte benötigen Prüfung.','How does LiveSync exchange knowledge files?','Wie tauscht LiveSync Wissensdateien aus?'),
]
def main():
    p=argparse.ArgumentParser();p.add_argument('--endpoint',required=True);p.add_argument('--alias',required=True);p.add_argument('--out',required=True);args=p.parse_args()
    request=urllib.request.Request(args.endpoint+'/v1/models')
    with urllib.request.urlopen(request,timeout=60) as response: catalog=json.load(response)
    assert args.alias in [x['id'] for x in catalog['data']], 'wrong model alias'
    times=[]
    def embed(text, query=False):
        text=' '.join(text.split())[:6000]
        if query:text='Instruct: Given a question, retrieve the document passage that best answers it.\nQuery: '+text
        start=time.perf_counter()
        req=urllib.request.Request(args.endpoint+'/v1/embeddings',data=json.dumps({'model':args.alias,'input':[text]}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=120) as r: data=json.load(r)
        times.append((time.perf_counter()-start)*1000)
        assert data['model']==args.alias
        v=data['data'][0]['embedding'];assert len(v)==1024
        norm=sum(x*x for x in v)**0.5;assert norm>0
        return [x/norm for x in v]
    rows=[];queries=[]
    for tag,en,de,enq,deq in topics:
        source=str(uuid.uuid5(uuid.NAMESPACE_URL,'https://example.invalid/loklm/'+tag))
        for i,text in enumerate([en,de,en+' Synthetic project appendix.',de+' Fiktiver Projektanhang.']):
            rows.append({'id':len(rows)+1,'source':source,'text':text,'vector':embed(text)})
        for q in [enq,deq]:queries.append({'text':q,'expected_source':source,'vector':embed(q,True)})
        print('embedded synthetic topic '+tag,flush=True)
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'model_fingerprint':args.alias,'rows':rows,'queries':queries,'embedding_ms':times},ensure_ascii=False))
    print(json.dumps({'rows':len(rows),'queries':len(queries),'dimension':1024,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
if __name__=='__main__':main()
