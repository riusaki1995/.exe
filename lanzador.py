import socketio
import time
import webbrowser
import threading
from pynput.keyboard import Key, Controller

# TU IP CONFIGURADA
URL_VPS = "http://144.217.80.11:3000" 

keyboard = Controller()
sio = socketio.Client()
USUARIO_TIKTOK = ""

special_keys = {'ctrl': Key.ctrl, 'shift': Key.shift, 'alt': Key.alt, 'meta': Key.cmd, 'win': Key.cmd, 'espacio': Key.space, 'enter': Key.enter, 'tab': Key.tab, 'arriba': Key.up, 'abajo': Key.down, 'izquierda': Key.left, 'derecha': Key.right}

@sio.event
def connect():
    room = USUARIO_TIKTOK.lower().replace('@', '')
    sio.emit('join_room', room)
    print(f"\n✅ CONECTADO: Recibiendo teclas para @{room}")

@sio.on('simular_tecla')
def on_simular_tecla(tecla):
    print(f"🚀 Ejecutando tecla: {tecla}")
    try:
        input_data = tecla.lower().split('+')
        keys_to_press = [special_keys.get(k.strip(), k.strip()[0]) for k in input_data]
        for k in keys_to_press: keyboard.press(k)
        time.sleep(0.15)
        for k in reversed(keys_to_press): keyboard.release(k)
    except: pass

if __name__ == '__main__':
    print("==========================================")
    print("   PANEL DE CONTROL - AGENCIA ELARBOL     ")
    print("==========================================")
    USUARIO_TIKTOK = input("Introduce tu usuario de TikTok: ")
    
    # Abre el panel web automáticamente
    threading.Thread(target=lambda: webbrowser.open(URL_VPS)).start()

    try:
        sio.connect(URL_VPS)
        sio.wait()
    except Exception as e:
        print(f"❌ Error: No se pudo conectar al servidor {URL_VPS}")
        input("Presiona Enter para salir...")