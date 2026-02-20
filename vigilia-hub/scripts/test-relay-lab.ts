import { Gpio } from "pigpio";

console.log(
  "Iniciando prueba de hardware: Módulo de Relé 1 y GPIO (Setup de Laboratorio)...",
);

// Respetando BCM PIN_MAPPING.md
// GPIO17 (Pin Físico 11) -> Relé 1 / IN1 (Audio OUT Intercept)
// GPIO27 (Pin Físico 13) -> Relé 1 / IN2 (Audio IN Intercept)
const RELAY_1_PIN = 17;
const RELAY_2_PIN = 27;

// Configurar los pines en modo Salida (OUTPUT)
const relay1 = new Gpio(RELAY_1_PIN, { mode: Gpio.OUTPUT });
const relay2 = new Gpio(RELAY_2_PIN, { mode: Gpio.OUTPUT });

// Estado seguro inicial.
// Mandamos 0 (LOW, 0V) para asegurarnos que los relés arranquen en Modo Transparente (NO cerrado).
relay1.digitalWrite(0);
relay2.digitalWrite(0);

console.log(
  "Relés inicializados exitosamente y forzados al estado seguro (LOW).",
);
console.log("Ejecutando conmutación de prueba ciclada...\n");

let isIntercepting = false;

// Rutina de prueba: Alternar el estado lógico cada 2 segundos
const testInterval = setInterval(() => {
  isIntercepting = !isIntercepting;
  const state = isIntercepting ? 1 : 0;

  // Escribir el nuevo estado usando pigpio
  relay1.digitalWrite(state);
  relay2.digitalWrite(state);

  if (state === 1) {
    console.log(
      `[+] HIGH (3.3V) enviado a GPIO17 y GPIO27: ¡CLACK! El LED del relé debe estar ON.`,
    );
  } else {
    console.log(
      `[-] LOW (0V) enviado a GPIO17 y GPIO27: ¡CLACK! El LED del relé debe estar OFF.`,
    );
  }
}, 2000);

// Apagar el test automático a los 11 segundos
setTimeout(() => {
  clearInterval(testInterval);
  // Dejamos las cosas de vuelta en 0 lógicos como medida de seguridad
  relay1.digitalWrite(0);
  relay2.digitalWrite(0);
  console.log("\nPrueba exitosa. Limpieza de hardware finalizada.");
  process.exit(0);
}, 11000);

// Manejar un Ctrl+C abrupto para apagar los relés antes de salir
process.on("SIGINT", () => {
  console.log("\nAbortado manualmente. Forzando LOW...");
  clearInterval(testInterval);
  relay1.digitalWrite(0);
  relay2.digitalWrite(0);
  process.exit(0);
});
