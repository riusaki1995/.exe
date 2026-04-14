
import sys, time
from pynput.keyboard import Key, Controller
keyboard = Controller()
input_data = sys.argv[1].lower().split('+')
special_keys = {'ctrl': Key.ctrl, 'shift': Key.shift, 'alt': Key.alt, 'meta': Key.cmd, 'win': Key.cmd, 'espacio': Key.space, 'enter': Key.enter, 'tab': Key.tab, 'arriba': Key.up, 'abajo': Key.down, 'izquierda': Key.left, 'derecha': Key.right}
try:
    keys_to_press = [special_keys.get(k.strip(), k.strip()[0]) for k in input_data]
    for k in keys_to_press: keyboard.press(k)
    time.sleep(0.15)
    for k in reversed(keys_to_press): keyboard.release(k)
except Exception as e:
    pass
