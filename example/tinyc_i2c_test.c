unsigned int i2c_base = 0x10010000;
unsigned int i2c_last_status = 0;

void i2c_master_init(unsigned int prescale, unsigned int timeout) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    i2c[0] = 0x80000000;
    i2c[0] = 0x00000002;
    i2c[2] = prescale;
    i2c[8] = timeout;
    i2c[9] = 0x3FFF;
    i2c_last_status = 0;
}

void i2c_prepare(void) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    i2c[0] = 0x00000002;
    i2c[0] = 0x00000032;
    i2c[9] = 0x3FFF;
}

void i2c_cleanup(void) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    i2c[0] = 0x0000000B;
    i2c[0] = 0x00000002;
    i2c[0] = 0x00000032;
}

unsigned int i2c_get_last_status(void) {
    return i2c_last_status;
}

int i2c_wait_done(int limit) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    unsigned int status = i2c[9];

    while (((status & 1) == 0) && (limit > 0)) {
        limit = limit - 1;
        status = i2c[9];
    }
    i2c_last_status = status;
    if (limit == 0) {
        i2c_cleanup();
        return 0;
    }
    if ((status & 0x203E) != 0) {
        return 0;
    }
    return 1;
}

int i2c_valid_length(int length) {
    if (length < 1) {
        return 0;
    }
    if (length > 16) {
        return 0;
    }
    return 1;
}

int i2c_load_tx(unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    int index = 0;

    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    while (index < length) {
        i2c[4] = data[index] & 0xFF;
        index = index + 1;
    }
    return 1;
}

int i2c_drain_rx(unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    unsigned int level = (i2c[6] >> 8) & 0xFF;
    unsigned int discarded = 0;
    int index = 0;

    if (level != length) {
        return 0;
    }
    discarded = i2c[5];
    while (index < length) {
        data[index] = i2c[5] & 0xFF;
        index = index + 1;
    }
    return 1;
}

int i2c_master_write(unsigned int address,
                     unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    i2c_prepare();
    if (i2c_load_tx(data, length) == 0) {
        return 0;
    }
    i2c[1] = (address << 8) | (length << 16);
    i2c[0] = 3;
    i2c[0] = 7;
    return i2c_wait_done(200000);
}

int i2c_master_read(unsigned int address,
                    unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    i2c_prepare();
    i2c[1] = 1 | (address << 8) | (length << 24);
    i2c[0] = 3;
    i2c[0] = 7;
    if (i2c_wait_done(200000) == 0) {
        return 0;
    }
    return i2c_drain_rx(data, length);
}

int i2c_master_write_read(unsigned int address,
                          unsigned int *tx_data, int tx_length,
                          unsigned int *rx_data, int rx_length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;

    if (i2c_valid_length(tx_length) == 0) {
        return 0;
    }
    if (i2c_valid_length(rx_length) == 0) {
        return 0;
    }
    i2c_prepare();
    if (i2c_load_tx(tx_data, tx_length) == 0) {
        return 0;
    }
    i2c[1] = 2 | (address << 8) |
             (tx_length << 16) | (rx_length << 24);
    i2c[0] = 3;
    i2c[0] = 7;
    if (i2c_wait_done(200000) == 0) {
        return 0;
    }
    return i2c_drain_rx(rx_data, rx_length);
}

int i2c_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;

    *detail = stage;
    *status = 0x0BAD;
    return 1;
}

int main(void) {
    volatile unsigned int *peer_ready =
        (volatile unsigned int *)0x008003C8;
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    unsigned int write_data[2];
    unsigned int read_data[2];
    unsigned int combined_tx[1];
    unsigned int combined_rx[2];
    int remaining = 100000;

    while ((*peer_ready == 0) && (remaining > 0)) {
        remaining = remaining - 1;
    }
    if (remaining == 0) {
        return i2c_fail(1);
    }

    i2c_master_init(9, 5000);
    write_data[0] = 0xA5;
    write_data[1] = 0x5A;
    if (i2c_master_write(0x52, write_data, 2) == 0) {
        return i2c_fail(2);
    }

    if (i2c_master_read(0x52, read_data, 2) == 0) {
        return i2c_fail(3);
    }
    if ((read_data[0] != 0x3C) || (read_data[1] != 0xC3)) {
        return i2c_fail(4);
    }

    combined_tx[0] = 0x10;
    if (i2c_master_write_read(0x52, combined_tx, 1,
                              combined_rx, 2) == 0) {
        return i2c_fail(5);
    }
    if ((combined_rx[0] != 0xDE) ||
        (combined_rx[1] != 0xAD)) {
        return i2c_fail(6);
    }

    if (i2c_master_read(0x53, read_data, 1) != 0) {
        return i2c_fail(7);
    }
    if ((i2c_get_last_status() & 2) == 0) {
        return i2c_fail(8);
    }

    *detail = 0x4001;
    *status = 0x600D;
    return 0;
}
