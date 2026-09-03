#define QSPI_BASE 0x10004000
#define QSPI_CTRL 0
#define QSPI_STATUS 1
#define QSPI_CLOCK_CFG 2
#define QSPI_TRANSFER_CFG 3
#define QSPI_PHASE_CFG 4
#define QSPI_LENGTH_CFG 5
#define QSPI_COMMAND_DATA 6
#define QSPI_ADDRESS_DATA 7
#define QSPI_RX_DATA_ADDRESS 0x10004028
#define QSPI_FIFO_STATUS 11
#define QSPI_IRQ_STATUS 13

#define QSPI_BUSY 1
#define QSPI_IRQ_DONE 1
#define QSPI_IRQ_ERROR 6
#define QSPI_IRQ_CLEAR 0x0000003f
#define QSPI_TIMEOUT 0x00100000

#define IMAGE_MAGIC 0x4d333246
#define IMAGE_OFFSET 0x00100000
#define IMAGE_HEADER_BYTES 20
#define FLASH_LIMIT 0x01000000
#define APPLICATION_BASE 0x00001000
#define APPLICATION_LIMIT 0x00008000
#define MAX_CHUNK_BYTES 0x0000fffc

#define STATUS_ADDRESS 0x08000000
#define STATUS_SUCCESS 0x600d0000
#define STATUS_FAILURE 0x0bad0000

#define FAILURE_QSPI 1
#define FAILURE_MAGIC 2
#define FAILURE_SIZE 3
#define FAILURE_LOAD 4
#define FAILURE_ENTRY 5
#define FAILURE_FLASH_RANGE 6
#define FAILURE_CRC 7

unsigned int crc32_byte(unsigned int crc, unsigned int byte_value) {
    unsigned int bit = 0;
    crc = crc ^ byte_value;
    while (bit < 8) {
        if ((crc & 1) != 0) {
            crc = (crc >> 1) ^ 0xedb88320;
        } else {
            crc = crc >> 1;
        }
        bit = bit + 1;
    }
    return crc;
}

/* The Tiny C IRQ controls require a concrete handler definition. */
void __irq_handler(void) {
}

void fail(unsigned int reason) {
    volatile unsigned int *status = (volatile unsigned int *)STATUS_ADDRESS;
    *status = STATUS_FAILURE | reason;
    while (1) {
    }
}

int qspi_read(unsigned int flash_address, volatile unsigned int *destination,
        unsigned int byte_count, unsigned int *crc) {
    volatile unsigned int *qspi = (volatile unsigned int *)QSPI_BASE;
    volatile unsigned char *rx_data = (volatile unsigned char *)QSPI_RX_DATA_ADDRESS;
    unsigned int timeout = QSPI_TIMEOUT;
    unsigned int received = 0;
    unsigned int word = 0;
    unsigned int word_bytes = 0;
    unsigned int level;
    unsigned int byte_value;
    unsigned int irq;
    unsigned int success = 0;

    while (timeout != 0) {
        level = (qspi[QSPI_FIFO_STATUS] >> 8) & 0xff;
        while (level != 0) {
            byte_value = *rx_data;
            level = level - 1;
        }
        if ((qspi[QSPI_STATUS] & QSPI_BUSY) == 0) {
            break;
        }
        timeout = timeout - 1;
    }
    if (timeout == 0) {
        goto qspi_read_done;
    }

    qspi[QSPI_CTRL] = 24;
    qspi[QSPI_CLOCK_CFG] = 1;
    qspi[QSPI_TRANSFER_CFG] = 0x00000088;
    qspi[QSPI_PHASE_CFG] = 0x00001808;
    qspi[QSPI_LENGTH_CFG] = byte_count;
    qspi[QSPI_COMMAND_DATA] = 0x03;
    qspi[QSPI_ADDRESS_DATA] = flash_address;
    qspi[QSPI_IRQ_STATUS] = QSPI_IRQ_CLEAR;
    qspi[QSPI_CTRL] = 1;
    qspi[QSPI_CTRL] = 3;

    timeout = QSPI_TIMEOUT;
    while (timeout != 0) {
        level = (qspi[QSPI_FIFO_STATUS] >> 8) & 0xff;
        while (level != 0) {
            byte_value = *rx_data;
            level = level - 1;
            if (received >= byte_count) {
                goto qspi_read_done;
            }
            word = (word << 8) | byte_value;
            *crc = crc32_byte(*crc, byte_value);
            word_bytes = word_bytes + 1;
            received = received + 1;
            if (word_bytes == 4) {
                *destination = word;
                destination = destination + 1;
                word = 0;
                word_bytes = 0;
            }
            timeout = QSPI_TIMEOUT;
        }

        irq = qspi[QSPI_IRQ_STATUS];
        if ((irq & QSPI_IRQ_ERROR) != 0) {
            goto qspi_read_done;
        }
        if ((qspi[QSPI_STATUS] & QSPI_BUSY) == 0) {
            if ((received == byte_count) && ((irq & QSPI_IRQ_DONE) != 0)) {
                success = 1;
            }
            goto qspi_read_done;
        }
        timeout = timeout - 1;
    }
qspi_read_done:
    qspi[QSPI_IRQ_STATUS] = QSPI_IRQ_CLEAR;
    return success;
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)STATUS_ADDRESS;
    unsigned int header[5];
    unsigned int crc = 0xffffffff;
    unsigned int payload_bytes;
    unsigned int load_address;
    unsigned int entry_address;
    unsigned int remaining;
    unsigned int chunk;
    unsigned int flash_address;
    volatile unsigned int *destination;

    __irq_disable();

    if (qspi_read(IMAGE_OFFSET, header, IMAGE_HEADER_BYTES, &crc) == 0) {
        fail(FAILURE_QSPI);
    }
    if (header[0] != IMAGE_MAGIC) {
        fail(FAILURE_MAGIC);
    }

    payload_bytes = header[1];
    load_address = header[2];
    entry_address = header[3];
    if ((payload_bytes == 0) || ((payload_bytes & 3) != 0)) {
        fail(FAILURE_SIZE);
    }
    if (((load_address & 3) != 0) || (load_address < APPLICATION_BASE)
            || (load_address >= APPLICATION_LIMIT)
            || (payload_bytes > APPLICATION_LIMIT - load_address)) {
        fail(FAILURE_LOAD);
    }
    if (((entry_address & 3) != 0) || (entry_address < load_address)
            || ((entry_address - load_address) >= payload_bytes)) {
        fail(FAILURE_ENTRY);
    }
    if (payload_bytes > FLASH_LIMIT - IMAGE_OFFSET - IMAGE_HEADER_BYTES) {
        fail(FAILURE_FLASH_RANGE);
    }

    crc = 0xffffffff;
    remaining = payload_bytes;
    flash_address = IMAGE_OFFSET + IMAGE_HEADER_BYTES;
    destination = (volatile unsigned int *)load_address;
    while (remaining != 0) {
        chunk = remaining;
        if (chunk > MAX_CHUNK_BYTES) {
            chunk = MAX_CHUNK_BYTES;
        }
        if (qspi_read(flash_address, destination, chunk, &crc) == 0) {
            fail(FAILURE_QSPI);
        }
        flash_address = flash_address + chunk;
        destination = destination + (chunk >> 2);
        remaining = remaining - chunk;
    }

    crc = ~crc;
    if (crc != header[4]) {
        fail(FAILURE_CRC);
    }
    *status = STATUS_SUCCESS;
    __jump(entry_address);
    return 0;
}
