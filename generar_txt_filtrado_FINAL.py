import os
import re
from datetime import datetime, timezone
import gspread
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.service_account import Credentials

FOLDER_IDS = [
    '1Bpj36KpYGbn2ru3mYF5G5m9-NoZw6DVL',
    '13K_NF_Aj4imdH2YYMnSYzJrRZ3iLZtPE'
]
CARPETA_DESPACHOS = r"C:\\Users\\usuario\\Desktop\\DESPACHOS"
LOCALES_MAP = {
    "AV2": "AV2",
    "NAZCA": "NAZCA",
    "LAMARCA": "LAMARCA",
    "CASTELLI": "CASTELLI",
    "CORRIENTES": "CORRIENTES",
    "CO2": "CO2",
    "MORENO": "MORENO",
    "QUILMES": "QUILMES",
    "SARMIENTO": "PRUONCE (SARMIENTO)"
}
EXTENSION_TXT = ".txt"

SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets.readonly']
creds = Credentials.from_service_account_file('service_account.json', scopes=SCOPES)
drive_service = build('drive', 'v3', credentials=creds)
gs = gspread.authorize(creds)

def archivo_modificado_hoy(fecha_str):
    hoy = datetime.now(timezone.utc).date()
    try:
        fecha_archivo = datetime.strptime(fecha_str, "%Y-%m-%dT%H:%M:%S.%fZ").date()
    except:
        return False
    return fecha_archivo == hoy

def obtener_archivos_modificados_hoy():
    archivos = []
    for folder_id in FOLDER_IDS:
        query = f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.spreadsheet'"
        results = drive_service.files().list(q=query, fields="files(id, name, modifiedTime)").execute()
        for file in results.get('files', []):
            if "✅" in file["name"]:
                continue  # ya procesado
            if archivo_modificado_hoy(file['modifiedTime']) and re.search(r"REM\s*\d+|REMITO\s*\d+", file['name'], re.IGNORECASE):
                archivos.append(file)
    return archivos

def detectar_local(nombre):
    nombre_upper = nombre.upper()
    for key, valor in LOCALES_MAP.items():
        if key.upper() in nombre_upper:
            return valor
    return None

def archivo_txt_ya_existe(nombre_txt, local):
    ruta = os.path.join(CARPETA_DESPACHOS, local, nombre_txt)
    return os.path.exists(ruta)

def marcar_como_procesado(file):
    nuevo_nombre = file['name'] + " ✅"
    try:
        drive_service.files().update(fileId=file['id'], body={'name': nuevo_nombre}).execute()
        print(f"[MARCA] Archivo renombrado como procesado: {nuevo_nombre}")
    except HttpError as error:
        print(f"[ERROR] No se pudo marcar como procesado: {error}")

def generar_txt_desde_hoja(file):
    try:
        print(f"[INFO] Procesando archivo: {file['name']}")
        sh = gs.open_by_key(file['id'])
        hoja = sh.worksheet("Hoja 1")
        codigos = hoja.col_values(1)[1:]  # desde A2

        if not codigos:
            print(f"[AVISO] Sin códigos: {file['name']}")
            return

        local = detectar_local(file['name'])
        if not local:
            print(f"[AVISO] No se detectó local en archivo: {file['name']}")
            return

        match = re.search(r"REM\s*(\d+)|REMITO\s*(\d+)", file['name'], re.IGNORECASE)
        if not match:
            print(f"[AVISO] No se encontró número de remito en: {file['name']}")
            return

        nro_remito = match.group(1) or match.group(2)
        nombre_txt = f"REM{nro_remito}.txt"

        if archivo_txt_ya_existe(nombre_txt, local):
            print(f"[SKIP] Ya existe: {nombre_txt} en {local}")
            marcar_como_procesado(file)
            return

        ruta_carpeta_local = os.path.join(CARPETA_DESPACHOS, local)
        os.makedirs(ruta_carpeta_local, exist_ok=True)

        ruta_guardado = os.path.join(ruta_carpeta_local, nombre_txt)
        with open(ruta_guardado, 'w', encoding='utf-8') as f:
            for codigo in codigos:
                if codigo.strip():
                    f.write(codigo.strip() + '\n')

        print(f"[OK] Generado: {ruta_guardado}")
        marcar_como_procesado(file)

    except Exception as e:
        print(f"[ERROR] {file['name']}: {e}")

if __name__ == "__main__":
    archivos = obtener_archivos_modificados_hoy()
    print(f"\nArchivos modificados hoy: {len(archivos)}\n")
    for archivo in archivos:
        generar_txt_desde_hoja(archivo)
