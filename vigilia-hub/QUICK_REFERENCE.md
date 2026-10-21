# Guía Rápida - Vigilia Hub

## 🚀 Inicio Rápido

### Iniciar sistema
```bash
sudo systemctl start vigilia-hub
```

### Detener sistema
```bash
sudo systemctl stop vigilia-hub
```

### Ver estado
```bash
sudo systemctl status vigilia-hub
```

### Ver logs en tiempo real
```bash
sudo journalctl -u vigilia-hub -f
```

---

## 🔧 Comandos Comunes

### Reiniciar servicio (después de cambios)
```bash
sudo systemctl restart vigilia-hub
```

### Ver últimos 50 errores
```bash
sudo journalctl -u vigilia-hub -p err -n 50
```

### Ver logs desde hace 1 hora
```bash
sudo journalctl -u vigilia-hub --since "1 hour ago"
```

### Editar configuración
```bash
nano /opt/vigilia-hub/.env
# Después de guardar:
sudo systemctl restart vigilia-hub
```

---

## 🧪 Tests de Hardware

### Test de relés
```bash
cd /opt/vigilia-hub
npm run test:relays
```

### Test de teclado
```bash
cd /opt/vigilia-hub
npm run test:keypad
```

### Test de audio
```bash
# Grabar 5 segundos
arecord -D hw:1,0 -f S16_LE -c 1 -r 48000 -d 5 test.wav

# Reproducir
aplay -D hw:1,0 test.wav
```

---

## 📊 Estados del Sistema

| Estado | Significado | Relés | Audio |
|--------|-------------|-------|-------|
| TRANSPARENT | Citófono normal | OFF | Normal |
| SCANNING_KEYPAD | Marcando número | OFF | Normal |
| AI_INTERCEPT | IA atendiendo | ON | Ruteado a RPi |
| COOLDOWN | Esperando | OFF | Normal |

---

## 🔌 Pines GPIO (BCM)

### Multiplexor (Teclado)
- S0: GPIO 5
- S1: GPIO 6
- S2: GPIO 13
- S3: GPIO 19
- SIG: GPIO 26

### Relés (Audio)
- Relay 1: GPIO 17
- Relay 2: GPIO 27

---

## 🐛 Troubleshooting Rápido

### Servicio no arranca
```bash
# Ver error específico
sudo journalctl -u vigilia-hub -n 20

# Probar manualmente
cd /opt/vigilia-hub
node dist/main.js
```

### GPIO stuck (no libera)
```bash
# Liberar todos los GPIO
echo 17 | sudo tee /sys/class/gpio/unexport
echo 27 | sudo tee /sys/class/gpio/unexport
echo 5 | sudo tee /sys/class/gpio/unexport
echo 6 | sudo tee /sys/class/gpio/unexport
echo 13 | sudo tee /sys/class/gpio/unexport
echo 19 | sudo tee /sys/class/gpio/unexport
echo 26 | sudo tee /sys/class/gpio/unexport

# Reiniciar servicio
sudo systemctl restart vigilia-hub
```

### Audio no funciona
```bash
# Verificar tarjeta
aplay -l

# Recargar ALSA
sudo alsa force-reload

# Reiniciar Raspberry Pi
sudo reboot
```

### Backend no conecta
```bash
# Verificar URL en .env
grep BACKEND_URL /opt/vigilia-hub/.env

# Probar TLS + credencial del hub (no hay /health público): 200 o 401.
# Procedimiento sin exponer el secret: INSTALLATION.md, "6.4 Test de Conectividad"

# Ver logs de conexión
sudo journalctl -u vigilia-hub | grep -i "websocket\|backend"
```

---

## 📁 Archivos Importantes

| Archivo | Ubicación | Propósito |
|---------|-----------|-----------|
| Configuración | `/opt/vigilia-hub/.env` | Variables de entorno |
| Logs | `/opt/vigilia-hub/logs/` | Archivos de log |
| Caché | `/opt/vigilia-hub/data/ai-units.json` | Caché local de casas |
| Código | `/opt/vigilia-hub/dist/` | JavaScript compilado |
| Servicio | `/etc/systemd/system/vigilia-hub.service` | Configuración systemd |

---

## 🔄 Actualizar Sistema

```bash
# Detener servicio
sudo systemctl stop vigilia-hub

# Actualizar código (si es Git)
cd /opt/vigilia-hub
git pull origin main

# O copiar archivos nuevos manualmente

# Reinstalar dependencias
npm install

# Recompilar
npm run build

# Iniciar servicio
sudo systemctl start vigilia-hub

# Verificar
sudo journalctl -u vigilia-hub -f
```

---

## 🔐 Seguridad

### Cambiar HUB_SECRET
```bash
nano /opt/vigilia-hub/.env
# Editar HUB_SECRET
# También actualizar en backend NestJS

sudo systemctl restart vigilia-hub
```

### Backup de configuración
```bash
# Backup de .env
cp /opt/vigilia-hub/.env /opt/vigilia-hub/.env.backup.$(date +%Y%m%d)

# Backup de caché
cp /opt/vigilia-hub/data/ai-units.json /opt/vigilia-hub/data/ai-units.json.backup.$(date +%Y%m%d)
```

---

## 📞 Ayuda

### Ver documentación completa
```bash
cd /opt/vigilia-hub

# README principal
cat README.md

# Guía de instalación
cat INSTALLATION.md

# Arquitectura
cat ARCHITECTURE.md
```

### Ver versión
```bash
cat /opt/vigilia-hub/package.json | grep version
```

### Ver estado del hardware
```bash
# GPIO
gpio readall

# Audio
aplay -l
arecord -l

# CPU y temperatura
vcgencmd measure_temp
top
```

---

**Vigilia Hub v1.0.0**  
Para más información: README.md
