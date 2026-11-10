#!/bin/sh
# Builds the password file from PICKUP_MQTT_PASSWORD / DROPOFF_MQTT_PASSWORD (.env) on every start, so no password, hashed or not, is committed. The ACL is copied in too: mosquitto wants both owned by its own user, which a bind-mounted file from the host is not.
set -e
: "${PICKUP_MQTT_PASSWORD:?PICKUP_MQTT_PASSWORD is not set}"
: "${DROPOFF_MQTT_PASSWORD:?DROPOFF_MQTT_PASSWORD is not set}"
PW=/mosquitto/data/passwords
rm -f "$PW"
mosquitto_passwd -c -b "$PW" pickup "$PICKUP_MQTT_PASSWORD"
mosquitto_passwd -b "$PW" dropoff "$DROPOFF_MQTT_PASSWORD"
chown mosquitto:mosquitto "$PW"
chmod 0700 "$PW"
install -o mosquitto -g mosquitto -m 0600 /mosquitto/config/acl.src /mosquitto/data/acl
exec mosquitto -c /mosquitto/config/mosquitto.conf
