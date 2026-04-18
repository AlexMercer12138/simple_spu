#!/usr/bin/env python3
"""
Simple CPU Assembler - Setup Script
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="simple-cpu-assembler",
    version="2.0.0",
    author="Mercer",
    author_email="alexmercer@outlook.com",
    description="Simple CPU 汇编器 - 支持 MOV/JMP/BRC 语法",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/AlexMercer12138/simple_cpu",
    py_modules=["assembler"],
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Assemblers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.6",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.6",
    entry_points={
        "console_scripts": [
            "simple-asm=assembler:main",
            "scpu-asm=assembler:main",
        ],
    },
    keywords="assembler cpu riscv verilog fpga",
    project_urls={
        "Bug Reports": "https://github.com/AlexMercer12138/simple_cpu/issues",
        "Source": "https://github.com/AlexMercer12138/simple_cpu",
    },
)
