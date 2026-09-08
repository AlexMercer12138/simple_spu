#ifndef MERC32_IRQ_H
#define MERC32_IRQ_H

unsigned int irq_save(void);
void irq_restore(unsigned int state);
void __irq_enable(void);
void __irq_disable(void);
void __irq_enable_level(void);

#endif
